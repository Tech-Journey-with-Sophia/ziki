import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agent: { findUnique: vi.fn(), update: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  membership: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { grantLevelByAdmin } from "./promotion";

const admin = { id: "admin-1", role: "user" as const };
const owner = { id: "owner-1", role: "user" as const };

function agentRow(overrides: Record<string, unknown> = {}) {
  return { id: "a1", tenantId: "t1", level: "working", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.agent.findUnique.mockResolvedValue(agentRow());
  db.agent.update.mockResolvedValue({});
  db.agentAuditEvent.create.mockResolvedValue({});
  db.membership.findUnique.mockResolvedValue({ role: "member" });
});

describe("grantLevelByAdmin (#451)", () => {
  it.each(["manager", "merger"] as const)("rejects an owner who is not a tenant admin making an agent a %s", async (level) => {
    const result = await grantLevelByAdmin({ actor: owner, agentId: "a1", level, reason: "trusted" });

    expect(result).toEqual({ ok: false, error: `Only a team admin can make an agent a ${level} agent.` });
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it.each(["manager", "merger"] as const)("lets a tenant admin make an agent a %s, recording the admin and the reason", async (level) => {
    db.membership.findUnique.mockResolvedValue({ role: "admin" });

    const result = await grantLevelByAdmin({ actor: admin, agentId: "a1", level, reason: "field lead" });

    expect(result).toEqual({ ok: true, changed: true });
    expect(db.agent.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { level, levelChangedAt: expect.any(Date) } });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "agent.level_changed",
          actorUserId: "admin-1",
          payload: expect.objectContaining({ from: "working", to: level, by: "tenant_admin", reason: "field lead" }),
        }),
      }),
    );
  });

  it.each(["manager", "merger"] as const)("requires a reason to make an agent a %s", async (level) => {
    db.membership.findUnique.mockResolvedValue({ role: "admin" });

    const result = await grantLevelByAdmin({ actor: admin, agentId: "a1", level, reason: "  " });

    expect(result.ok).toBe(false);
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("lets a tenant admin move an agent back to working without a reason", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "owner" });
    db.agent.findUnique.mockResolvedValue(agentRow({ level: "manager" }));

    expect(await grantLevelByAdmin({ actor: admin, agentId: "a1", level: "working", reason: "" })).toEqual({ ok: true, changed: true });
  });

  it("changes nothing when the agent already has that class", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "admin" });
    db.agent.findUnique.mockResolvedValue(agentRow({ level: "merger" }));

    expect(await grantLevelByAdmin({ actor: admin, agentId: "a1", level: "merger", reason: "again" })).toEqual({ ok: true, changed: false });
    expect(db.agent.update).not.toHaveBeenCalled();
    expect(db.agentAuditEvent.create).not.toHaveBeenCalled();
  });

  it("reports a missing agent", async () => {
    db.agent.findUnique.mockResolvedValue(null);
    expect(await grantLevelByAdmin({ actor: admin, agentId: "nope", level: "manager", reason: "x" })).toEqual({ ok: false, error: "Agent not found." });
  });
});
