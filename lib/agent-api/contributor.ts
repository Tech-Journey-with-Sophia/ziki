import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { WORK_READINESS_VOTE_THRESHOLD } from "@/lib/ticket-assignment";
import { workflowFor } from "@/lib/workflow";
import { isConfirmed } from "@/lib/agent-api/validation";

export type ClaimableIssue = {
  id: string;
  number: number;
  title: string;
  projectId: string;
  voteCount: number;
  severity: string;
  createdAt: Date;
};

/**
 * Scan for issues ready to be claimed or bid on by contributors.
 */
export async function findClaimableIssues(
  agent: AgentContext,
  projectId: string,
  limit = 50,
): Promise<ClaimableIssue[]> {
  requireLevel(agent, "working");
  const workflow = await workflowFor(projectId);
  const offerCutoff = new Date(Date.now() - workflow.offerWindowSeconds * 1000);

  const candidates = await prisma.bug.findMany({
    where: {
      tenantId: agent.tenantId,
      projectId,
      isDeleted: false,
      status: "open",
      voteCount: { gte: WORK_READINESS_VOTE_THRESHOLD },
      claims: {
        none: {
          releasedAt: null,
          OR: [
            { status: "active" },
            { status: "offered", offeredAt: { gt: offerCutoff } },
          ],
        },
      },
    },
    take: limit * 2,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      number: true,
      title: true,
      projectId: true,
      voteCount: true,
      severity: true,
      createdAt: true,
    },
  });

  const claimable: ClaimableIssue[] = [];
  for (const bug of candidates) {
    if (claimable.length >= limit) break;
    if (!(await isConfirmed(bug.id))) continue;

    claimable.push({
      id: bug.id,
      number: bug.number,
      title: bug.title,
      projectId: bug.projectId,
      voteCount: bug.voteCount,
      severity: bug.severity,
      createdAt: bug.createdAt,
    });
  }

  return claimable;
}
