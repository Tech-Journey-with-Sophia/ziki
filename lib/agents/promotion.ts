import type { AgentLevel, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import { isTenantAdmin } from "@/lib/agents/membership";
import type { AppRole } from "@/lib/roles";

/**
 * Changing an agent's class by hand (#451).
 *
 * Every agent is a working agent from the start, and nothing moves an agent
 * between classes automatically: no class is earned from recorded work, and
 * missed claims release the claim without demoting the agent. Manager and
 * merger are a tenant admin's grant, and the admin and the reason are recorded.
 *
 * An agent can't change its own class: nothing here reads a class from an
 * agent request, and the only caller-supplied class is an admin's.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type AdminGrantInput = {
  actor: { id: string; role?: AppRole | null };
  agentId: string;
  level: AgentLevel;
  /** Why, recorded on the audit row. Required for manager and merger. */
  reason: string;
};

export type GrantResult = { ok: true; changed: boolean } | { ok: false; error: string };

/**
 * A tenant admin sets an agent's class. Being the agent's owner is not enough,
 * and an owner's own workspace role never changes the class by itself: the
 * admin and the reason are written to the audit row.
 */
export async function grantLevelByAdmin(input: AdminGrantInput, db: Db = prisma): Promise<GrantResult> {
  const agent = await db.agent.findUnique({
    where: { id: input.agentId },
    select: { id: true, tenantId: true, level: true },
  });
  if (!agent) return { ok: false, error: "Agent not found." };

  const admin = await isTenantAdmin({ id: input.actor.id, role: input.actor.role }, agent.tenantId);
  if (!admin) {
    return { ok: false, error: `Only a team admin can make an agent a ${AGENT_LEVEL_LABELS[input.level].toLowerCase()}.` };
  }
  if (input.level !== "working" && !input.reason.trim()) {
    return { ok: false, error: `Record why the agent becomes a ${AGENT_LEVEL_LABELS[input.level].toLowerCase()}.` };
  }
  if (agent.level === input.level) return { ok: true, changed: false };

  await db.agent.update({
    where: { id: input.agentId },
    data: { level: input.level, levelChangedAt: new Date() },
  });
  await audit(
    { agentId: input.agentId, tenantId: agent.tenantId },
    "agent.level_changed",
    `agent:${input.agentId}`,
    { from: agent.level, to: input.level, by: "tenant_admin", reason: input.reason },
    { actorUserId: input.actor.id, db },
  );
  return { ok: true, changed: true };
}
