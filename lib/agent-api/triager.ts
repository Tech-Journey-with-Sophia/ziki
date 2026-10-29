import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { isConfirmed } from "@/lib/agent-api/validation";
import { reviewerConflict } from "@/lib/agents/independence";

export type TriageableIssue = {
  id: string;
  number: number;
  title: string;
  projectId: string;
  createdAt: Date;
};

/**
 * Scan for open issues needing duplicate assessment / triage clearance.
 */
export async function findTriageableIssues(
  agent: AgentContext,
  projectId: string,
  limit = 50,
): Promise<TriageableIssue[]> {
  requireLevel(agent, "working");

  const candidates = await prisma.bug.findMany({
    where: {
      tenantId: agent.tenantId,
      projectId,
      isDeleted: false,
      status: "open",
      validations: {
        none: {
          kind: "duplicate",
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

  const triageable: TriageableIssue[] = [];
  for (const bug of candidates) {
    if (triageable.length >= limit) break;
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

    triageable.push({
      id: bug.id,
      number: bug.number,
      title: bug.title,
      projectId: bug.projectId,
      createdAt: bug.createdAt,
    });
  }

  return triageable;
}
