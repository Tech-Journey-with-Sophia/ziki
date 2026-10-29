import { prisma } from "@/lib/prisma";
import { awardBid } from "@/lib/agent-api/bid";
import { isConfirmed } from "@/lib/agent-api/validation";
import { openIssueStages } from "@/lib/issue-stage";
import type { PrismaClient } from "@prisma/client";
import { WORK_READINESS_VOTE_THRESHOLD } from "@/lib/ticket-assignment";
import { commentedSummary } from "@/lib/activity-log";
import { publish } from "@/lib/agent-api/events";
import { logger } from "@/lib/logger";

export type BidSweepResult = {
  invited: number;
  assigned: number;
  lapsed: number;
  errors: Array<{ issueId: string; error: string }>;
};

type GoAheadMetadata = {
  action?: string;
  bidId?: string;
  agentId?: string;
  beneficiaryUserId?: string;
  agentName?: string;
  selectedAt?: string;
  resolved?: boolean;
  lapsed?: boolean;
};

/**
 * Direct Fair Bid Auto-Assignment Sweep
 *
 * Automatically assigns open bids on confirmed issues directly without a comment handshake:
 *
 * 1. Scans for open, confirmed issues with pending bids and no active assignee/claim.
 * 2. Selects a bidder fairly so all agents and contributors have an equal chance at tasks:
 *     - Prioritizes bidders with fewest active claims (workload balancing).
 *     - Prioritizes bidders with fewest total historical tasks in the project.
 *     - Uses earliest bid creation time as tie-breaker (FIFO).
 * 3. Immediately awards the bid and assigns the task to the selected bidder.
 * 4. Resolves any legacy pending go-ahead comments and posts an assignment notification.
 */
export async function sweepPendingBids(options?: {
  now?: Date;
  responseWindowMs?: number;
  limit?: number;
}): Promise<BidSweepResult> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 200;

  const result: BidSweepResult = {
    invited: 0,
    assigned: 0,
    lapsed: 0,
    errors: [],
  };

  // Find candidate issues: open, confirmed, unassigned, with pending bids and no live claim
  const candidateIssues = await prisma.bug.findMany({
    where: {
      status: "open",
      isDeleted: false,
      assigneeId: null,
      voteCount: { gte: WORK_READINESS_VOTE_THRESHOLD },
      claims: {
        none: {
          releasedAt: null,
          OR: [{ status: "active" }, { status: "offered" }],
        },
      },
      bids: {
        some: {
          withdrawnAt: null,
          awardedAt: null,
        },
      },
    },
    select: {
      id: true,
      title: true,
      number: true,
      tenantId: true,
      projectId: true,
      reporterId: true,
      severity: true,
      voteCount: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  for (const issue of candidateIssues) {
    try {
      let isConfirmedIssue = await isConfirmed(issue.id);
      if (!isConfirmedIssue && typeof (prisma as unknown as { bug?: { findMany?: unknown } }).bug?.findMany === "function") {
        try {
          const stage = (await openIssueStages(prisma as unknown as PrismaClient, { id: issue.id })).get(issue.id);
          isConfirmedIssue = stage === "ready" || stage === "confirmed";
        } catch {}
      }
      if (!isConfirmedIssue) continue;

      // Find all open, unawarded bids on this issue
      const openBids = await prisma.issueBid.findMany({
        where: {
          bugId: issue.id,
          withdrawnAt: null,
          awardedAt: null,
        },
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              ownerUserId: true,
              revokedAt: true,
            },
          },
          beneficiary: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      if (openBids.length === 0) continue;

      // Build fairness candidate list
      const candidateBidders = [];
      for (const bid of openBids) {
        if (bid.agent.revokedAt) continue;

        // Active claims check for this bidder's beneficiary in this project
        // Used for fair workload-balancing sorting (fewest active claims first)
        const activeClaimsCount = await prisma.issueClaim.count({
          where: {
            beneficiaryUserId: bid.beneficiaryUserId,
            status: "active",
            releasedAt: null,
            bug: { tenantId: issue.tenantId, projectId: issue.projectId, isDeleted: false },
          },
        });

        // Total historical tasks awarded in this project
        const totalAwardedClaimsCount = await prisma.issueClaim.count({
          where: {
            beneficiaryUserId: bid.beneficiaryUserId,
            claimedAt: { not: null },
            bug: { tenantId: issue.tenantId, projectId: issue.projectId, isDeleted: false },
          },
        });

        candidateBidders.push({
          bid,
          activeClaimsCount,
          totalAwardedClaimsCount,
        });
      }

      if (candidateBidders.length === 0) continue;

      // Fairness sorting:
      // 1. Fewest current active tasks (workload balancing)
      // 2. Fewest historical tasks awarded in project (fair opportunity)
      // 3. Earliest bid createdAt (FIFO tie-breaker)
      candidateBidders.sort((a, b) => {
        if (a.activeClaimsCount !== b.activeClaimsCount) {
          return a.activeClaimsCount - b.activeClaimsCount;
        }
        if (a.totalAwardedClaimsCount !== b.totalAwardedClaimsCount) {
          return a.totalAwardedClaimsCount - b.totalAwardedClaimsCount;
        }
        return a.bid.createdAt.getTime() - b.bid.createdAt.getTime();
      });

      const selected = candidateBidders[0].bid;
      const agentName = selected.agent.name;
      const authorId = issue.reporterId ?? selected.beneficiaryUserId ?? "system";

      // Directly award the bid to the fair winner!
      await awardBid(
        { id: authorId, role: "super_admin" },
        selected.id,
      );

      // Clean up / resolve any existing legacy go-ahead comments on this issue
      try {
        const legacyGoAheadComments = await prisma.comment.findMany({
          where: {
            bugId: issue.id,
            deletedAt: null,
          },
          take: 10,
          orderBy: { createdAt: "desc" },
        });

        for (const comment of legacyGoAheadComments) {
          const meta = comment.metadata as GoAheadMetadata | null;
          if (meta?.action === "bid_go_ahead" && !meta.resolved) {
            await prisma.comment.update({
              where: { id: comment.id },
              data: {
                metadata: {
                  ...meta,
                  resolved: true,
                  assignedAt: now.toISOString(),
                },
              },
            });
          }
        }
      } catch (cleanupErr) {
        logger.warn(`[cron] Could not resolve legacy go-ahead comment on issue ${issue.id}:`, cleanupErr);
      }

      // Post confirmation assignment comment
      const confirmText = `Confirmed! Issue assigned to @[${agentName}](${agentName}) via bid sweep.`;
      const confirmComment = await prisma.comment.create({
        data: {
          bugId: issue.id,
          authorId,
          body: confirmText,
          type: "comment",
          metadata: {
            action: "bid_assigned",
            bidId: selected.id,
            agentId: selected.agentId,
            beneficiaryUserId: selected.beneficiaryUserId,
          },
        },
      });

      await prisma.bugActivity.create({
        data: {
          bugId: issue.id,
          actorId: authorId,
          type: "commented",
          summary: commentedSummary(confirmText),
          metadata: { commentId: confirmComment.id, action: "bid_assigned" },
        },
      });

      await publish(prisma, {
        tenantId: issue.tenantId,
        type: "comment.created",
        bugId: issue.id,
        payload: { commentId: confirmComment.id, issueId: issue.id, authorId },
      });

      result.assigned++;
    } catch (error) {
      logger.error(`[cron] Error processing bids for issue ${issue.id}:`, error);
      result.errors.push({
        issueId: issue.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
