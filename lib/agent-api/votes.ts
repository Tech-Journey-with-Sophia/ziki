import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { hasLevel } from "@/lib/agents/levels";
import { IssueApiError } from "@/lib/agent-api/issues";
import { publish } from "@/lib/agent-api/events";
import { MANAGER_VOTE_WEIGHT, reconcileVoteCount, tallyVoteGroups } from "@/lib/voting";

const id = z.string().trim().min(1).max(191);

/** Optional body. `projectId` may also arrive as a query parameter. */
export const voteSchema = z.object({ projectId: id.optional() }).strict();

type Tx = Prisma.TransactionClient;

export type AgentVoteResult = {
  voted: boolean;
  voteCount: number;
  /** True when this call changed the owner's vote. A repeat is false. */
  changed: boolean;
  /** How many upvotes the owner's vote counts as; 0 when there is none. */
  weight: number;
};

type LockedIssue = { id: string; reporterId?: string | null; beneficiaryUserId?: string | null };

async function lockedIssue(tx: Tx, caller: AgentContext, projectId: string, bugId: string): Promise<LockedIssue> {
  const locked = await tx.$queryRaw<LockedIssue[]>`
    SELECT "id", "reporterId", "beneficiaryUserId" FROM "Bug"
    WHERE "id" = ${bugId}
      AND "tenantId" = ${caller.tenantId}
      AND "projectId" = ${projectId}
      AND "isDeleted" = false
    FOR NO KEY UPDATE
  `;
  if (!locked.length) throw new IssueApiError(404, "Issue not found in this project.");
  return locked[0];
}

/**
 * A manager or merger agent's upvote counts as MANAGER_VOTE_WEIGHT, except on
 * its owner's own report: independence is by owner, so nobody can push their
 * own idea past the upvote gate.
 */
export function upvoteWeight(caller: Pick<AgentContext, "level" | "ownerId">, issue: LockedIssue): number {
  if (!hasLevel(caller.level, "manager")) return 1;
  if (issue.reporterId === caller.ownerId || issue.beneficiaryUserId === caller.ownerId) return 1;
  return MANAGER_VOTE_WEIGHT;
}

async function recount(tx: Tx, bugId: string): Promise<number> {
  const groups = await tx.vote.groupBy({
    by: ["value"],
    where: { bugId },
    _count: { _all: true },
  });
  const { likeCount, dislikeCount } = tallyVoteGroups(groups);
  const voteCount = reconcileVoteCount(likeCount, dislikeCount);
  await tx.bug.update({ where: { id: bugId }, data: { voteCount } });
  return voteCount;
}

/**
 * Records the agent's owner as an upvote. One person, one vote: another agent
 * of the same owner does not add a second upvote. A manager agent's upvote
 * counts as MANAGER_VOTE_WEIGHT (see `upvoteWeight`). Repeating the call
 * leaves the count unchanged.
 */
export async function upvoteIssue(
  caller: AgentContext,
  projectId: string,
  bugId: string,
): Promise<AgentVoteResult> {
  return prisma.$transaction(async (tx) => {
    const issue = await lockedIssue(tx, caller, projectId, bugId);
    const weight = upvoteWeight(caller, issue);
    const existing = await tx.vote.findUnique({
      where: { userId_bugId: { userId: caller.ownerId, bugId } },
    });
    if (existing?.value === weight) {
      const current = await tx.bug.findUnique({ where: { id: bugId }, select: { voteCount: true } });
      return { voted: true, voteCount: current?.voteCount ?? 0, changed: false, weight };
    }
    if (existing) {
      await tx.vote.update({ where: { id: existing.id }, data: { value: weight } });
    } else {
      await tx.vote.create({ data: { userId: caller.ownerId, bugId, value: weight } });
    }
    const voteCount = await recount(tx, bugId);
    await publish(tx, {
      tenantId: caller.tenantId,
      type: "issue.voted",
      actorAgentId: caller.agentId,
      bugId,
      payload: { issueId: bugId, projectId, userId: caller.ownerId, voteCount, voted: true, weight },
    });
    return { voted: true, voteCount, changed: true, weight };
  });
}

/** Removes the owner's upvote. Repeating the call when there is none is a no-op. */
export async function removeUpvote(
  caller: AgentContext,
  projectId: string,
  bugId: string,
): Promise<AgentVoteResult> {
  return prisma.$transaction(async (tx) => {
    await lockedIssue(tx, caller, projectId, bugId);
    const existing = await tx.vote.findUnique({
      where: { userId_bugId: { userId: caller.ownerId, bugId } },
    });
    if (!existing) {
      const issue = await tx.bug.findUnique({ where: { id: bugId }, select: { voteCount: true } });
      return { voted: false, voteCount: issue?.voteCount ?? 0, changed: false, weight: 0 };
    }
    await tx.vote.delete({ where: { id: existing.id } });
    const voteCount = await recount(tx, bugId);
    await publish(tx, {
      tenantId: caller.tenantId,
      type: "issue.voted",
      actorAgentId: caller.agentId,
      bugId,
      payload: { issueId: bugId, projectId, userId: caller.ownerId, voteCount, voted: false },
    });
    return { voted: false, voteCount, changed: true, weight: 0 };
  });
}
