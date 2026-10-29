import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { isConfirmed } from "@/lib/agent-api/validation";
import { reviewerConflict } from "@/lib/agents/independence";

export type ReviewableIssue = {
  id: string;
  number: number;
  title: string;
  projectId: string;
  stage: "reported" | "confirmed";
  reviewType: "validation" | "test";
  pullRequestUrl?: string | null;
  createdAt: Date;
};

/**
 * Scan for issues ready for reviewer validation or PR testing.
 */
export async function findReviewableIssues(
  agent: AgentContext,
  projectId: string,
  reviewType: "validation" | "test" | "all" = "all",
  limit = 50,
): Promise<ReviewableIssue[]> {
  requireLevel(agent, "working");

  const results: ReviewableIssue[] = [];

  // 1. Validation candidates: unconfirmed issues needing confirmation
  if (reviewType === "validation" || reviewType === "all") {
    const unconfirmedBugs = await prisma.bug.findMany({
      where: {
        tenantId: agent.tenantId,
        projectId,
        isDeleted: false,
        status: "open",
        validations: {
          none: {
            agentId: agent.agentId,
          },
        },
      },
      take: limit,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        number: true,
        title: true,
        projectId: true,
        reporterId: true,
        beneficiaryUserId: true,
        createdByAgentId: true,
        createdByAgent: { select: { ownerUserId: true } },
        createdAt: true,
        claims: {
          where: { status: "active", releasedAt: null },
          select: { agentId: true, beneficiaryUserId: true, agent: { select: { ownerUserId: true } } },
        },
      },
    });

    for (const bug of unconfirmedBugs) {
      if (results.length >= limit) break;
      if (await isConfirmed(bug.id)) continue;

      const reviewed = {
        reporterId: bug.reporterId,
        beneficiaryUserId: bug.beneficiaryUserId,
        createdByAgentId: bug.createdByAgentId,
        createdByAgent: bug.createdByAgent,
        claims: bug.claims.map((c) => ({
          status: "active" as const,
          releasedAt: null,
          agentId: c.agentId,
          beneficiaryUserId: c.beneficiaryUserId,
          agent: c.agent,
        })),
      };
      if (reviewerConflict({ id: agent.agentId, ownerUserId: agent.ownerId }, reviewed)) continue;

      results.push({
        id: bug.id,
        number: bug.number,
        title: bug.title,
        projectId: bug.projectId,
        stage: "reported",
        reviewType: "validation",
        createdAt: bug.createdAt,
      });
    }
  }

  // 2. Test candidates: PR linked, needing goodToMerge test verdicts
  if (reviewType === "test" || reviewType === "all") {
    const testCandidates = await prisma.bug.findMany({
      where: {
        tenantId: agent.tenantId,
        projectId,
        isDeleted: false,
        status: { in: ["open", "in_progress"] },
        pullRequestUrl: { not: null },
        testVerdicts: {
          none: {
            agentId: agent.agentId,
          },
        },
      },
      take: limit,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        number: true,
        title: true,
        projectId: true,
        pullRequestUrl: true,
        reporterId: true,
        beneficiaryUserId: true,
        createdByAgentId: true,
        createdByAgent: { select: { ownerUserId: true } },
        createdAt: true,
        claims: {
          where: { status: "active", releasedAt: null },
          select: { agentId: true, beneficiaryUserId: true, agent: { select: { ownerUserId: true } } },
        },
      },
    });

    for (const bug of testCandidates) {
      if (results.length >= limit) break;

      const reviewed = {
        reporterId: bug.reporterId,
        beneficiaryUserId: bug.beneficiaryUserId,
        createdByAgentId: bug.createdByAgentId,
        createdByAgent: bug.createdByAgent,
        claims: bug.claims.map((c) => ({
          status: "active" as const,
          releasedAt: null,
          agentId: c.agentId,
          beneficiaryUserId: c.beneficiaryUserId,
          agent: c.agent,
        })),
      };
      if (reviewerConflict({ id: agent.agentId, ownerUserId: agent.ownerId }, reviewed)) continue;

      results.push({
        id: bug.id,
        number: bug.number,
        title: bug.title,
        projectId: bug.projectId,
        stage: "confirmed",
        reviewType: "test",
        pullRequestUrl: bug.pullRequestUrl,
        createdAt: bug.createdAt,
      });
    }
  }

  return results;
}
