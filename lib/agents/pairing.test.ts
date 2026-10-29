import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const mock = {
    agentPairing: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    agent: { create: vi.fn(), delete: vi.fn(), count: vi.fn(async () => 0), findUnique: vi.fn() },
    agentApiKey: { create: vi.fn() },
    agentAuditEvent: { create: vi.fn() },
    membership: { findMany: vi.fn(), findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return mock;
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { hashSecret, normalizeUserCode } from "./keys";
import {
  PAIRING_TTL_MS,
  approvePairing,
  cleanupExpiredPairings,
  collectPairing,
  materializeApprovedPairings,
  pairingApprovalPath,
  startPairing,
} from "./pairing";
import { DEFAULT_AGENT_LEVEL } from "./levels";
import { createAgentSchema } from "./registry";
import { MAX_ACTIVE_AGENTS_PER_OWNER } from "./registry-limits";
import { AGENT_INSTRUCTIONS_MAX } from "@/lib/agent-messages";

const NOW = new Date("2026-10-19T12:00:00Z");
const DEVICE = "d".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-secret-at-least-16-chars");
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  db.agentPairing.deleteMany.mockResolvedValue({ count: 0 });
  db.membership.findMany.mockResolvedValue([{ tenantId: "tenant_zedu", role: "member", tenant: { slug: "zedu" } }]);
  db.project.findFirst.mockResolvedValue({ id: "project_zedu" });
  db.agent.create.mockResolvedValue({ id: "agent9", name: "Ada's Claude" });
  db.agent.findUnique.mockResolvedValue({ level: "working" });
});

describe("startPairing (#427)", () => {
  it("stores only hashes of both codes, for 15 minutes", async () => {
    const result = await startPairing({ name: "Ada's Claude", model: "Claude" }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = db.agentPairing.create.mock.calls[0][0];
    expect(data.codeHash).toBe(hashSecret(normalizeUserCode(result.userCode)!));
    expect(data.deviceCodeHash).toBe(hashSecret(result.deviceCode));
    expect(JSON.stringify(data)).not.toContain(result.deviceCode);
    expect(data.expiresAt.getTime() - NOW.getTime()).toBe(PAIRING_TTL_MS);
    expect(data.ownerUserId).toBeUndefined();
  });

  it("stores the level the agent asked for (#425)", async () => {
    const result = await startPairing({ name: "Ada", level: "working" }, NOW);
    expect(result.ok).toBe(true);
    expect(db.agentPairing.create.mock.calls[0][0].data.proposedLevel).toBe("working");
  });

  it("accepts working (and old role names that map to it) but refuses admin-granted classes and unknown levels", async () => {
    for (const level of ["working", "observer", "contributor", "triager", "reviewer"]) {
      expect(await startPairing({ name: "Ada", level }, NOW)).toMatchObject({ ok: true });
      expect(db.agentPairing.create.mock.calls.at(-1)![0].data.proposedLevel).toBe("working");
    }
    const created = db.agentPairing.create.mock.calls.length;
    for (const level of ["manager", "merger", "dispatcher", "admin_merger"]) {
      const refused = await startPairing({ name: "Ada", level }, NOW);
      expect(refused).toMatchObject({ ok: false });
      if (!refused.ok) expect(refused.error).toBe("Agents cannot register as manager or merger agents. A tenant admin grants these classes later.");
    }
    const unknown = await startPairing({ name: "Ada", level: "wizard" }, NOW);
    expect(unknown).toMatchObject({ ok: false });
    if (!unknown.ok) expect(unknown.error).toBe("Unknown level. Send one of: working.");
    expect(db.agentPairing.create).toHaveBeenCalledTimes(created);
    await startPairing({ name: "Ada" }, NOW);
    expect(db.agentPairing.create.mock.calls.at(-1)![0].data.proposedLevel).toBe(DEFAULT_AGENT_LEVEL);
  });

  it("uses the same default level as the settings path (#426)", async () => {
    await startPairing({ name: "Ada" }, NOW);
    expect(db.agentPairing.create.mock.calls[0][0].data.proposedLevel).toBe(DEFAULT_AGENT_LEVEL);
    expect(createAgentSchema.parse({ name: "Ada", projectId: "project_zedu" }).level).toBe(DEFAULT_AGENT_LEVEL);
  });

  it("needs a name", async () => {
    expect(await startPairing({}, NOW)).toMatchObject({ ok: false });
    expect(db.agentPairing.create).not.toHaveBeenCalled();
  });

  it("stores proposed instructions, trimmed, for the owner to review (#431)", async () => {
    await startPairing({ name: "Ada", instructions: "  Focus on desktop bugs.  " }, NOW);
    expect(db.agentPairing.create.mock.calls[0][0].data.proposedInstructions).toBe("Focus on desktop bugs.");
  });

  it("treats omitted or blank instructions as none (#431)", async () => {
    await startPairing({ name: "Ada" }, NOW);
    await startPairing({ name: "Ada", instructions: "   " }, NOW);
    expect(db.agentPairing.create.mock.calls[0][0].data.proposedInstructions).toBeNull();
    expect(db.agentPairing.create.mock.calls[1][0].data.proposedInstructions).toBeNull();
  });

  it("refuses instructions over 4000 characters, or that aren't text (#431)", async () => {
    const tooLong = await startPairing({ name: "Ada", instructions: "x".repeat(AGENT_INSTRUCTIONS_MAX + 1) }, NOW);
    expect(tooLong).toMatchObject({ ok: false });
    if (!tooLong.ok) expect(tooLong.error).toContain(String(AGENT_INSTRUCTIONS_MAX));
    expect(await startPairing({ name: "Ada", instructions: { text: "hi" } }, NOW)).toMatchObject({ ok: false });
    expect(db.agentPairing.create).not.toHaveBeenCalled();
    // Exactly at the limit is fine.
    expect(await startPairing({ name: "Ada", instructions: "x".repeat(AGENT_INSTRUCTIONS_MAX) }, NOW)).toMatchObject({ ok: true });
  });

  it("builds an approval link that carries the user code, not the device secret", () => {
    expect(pairingApprovalPath("KX7P-2MQD")).toBe("/settings/agents/pair?code=KX7P-2MQD");
  });
});

describe("approvePairing (#427)", () => {
  it("sets the approver as owner, only while nobody has approved it", async () => {
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    db.agentPairing.findUnique.mockResolvedValue({ id: "p1", proposedName: "Ada's Claude", proposedModel: "Claude" });
    expect(await approvePairing({ id: "ada" }, "abcd-2345", NOW, "project_zedu")).toEqual({ ok: true, name: "Ada's Claude" });
    expect(db.agent.create.mock.calls[0][0].data).toMatchObject({
      ownerUserId: "ada",
      tenantId: "tenant_zedu",
      name: "Ada's Claude",
      level: DEFAULT_AGENT_LEVEL,
    });
    expect(db.agent.create.mock.calls[0][0].data.apiKeys).toBeUndefined();
    const { where, data } = db.agentPairing.updateMany.mock.calls[0][0];
    expect(where).toEqual({
      codeHash: hashSecret("ABCD2345"),
      approvedAt: null,
      ownerUserId: null,
      expiresAt: { gt: NOW },
      OR: [{ proposedLevel: null }, { proposedLevel: { in: ["working"] } }],
    });
    expect(data).toEqual({ ownerUserId: "ada", tenantId: "tenant_zedu", projectId: "project_zedu", approvedAt: NOW });
  });

  it("creates the agent at the requested level stored at pairing start (#425)", async () => {
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    db.agentPairing.findUnique.mockResolvedValue({ id: "p1", proposedName: "Ada", proposedModel: null, proposedLevel: "working" });
    await approvePairing({ id: "ada" }, "ABCD-2345", NOW, "project_zedu");
    expect(db.agent.create.mock.calls[0][0].data.level).toBe("working");
  });

  it("creates the agent with the instructions the owner approved, not the agent's proposal (#431)", async () => {
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    db.agentPairing.findUnique.mockResolvedValue({ id: "p1", proposedName: "Ada", proposedModel: null, proposedLevel: null });
    await approvePairing({ id: "ada" }, "ABCD-2345", NOW, "project_zedu", undefined, "  Owner-edited brief.  ");
    expect(db.agent.create.mock.calls[0][0].data.instructions).toBe("Owner-edited brief.");
  });

  it("stores no instructions when the owner clears them or the form sends none (#431)", async () => {
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    db.agentPairing.findUnique.mockResolvedValue({ id: "p1", proposedName: "Ada", proposedModel: null, proposedLevel: null });
    await approvePairing({ id: "ada" }, "ABCD-2345", NOW, "project_zedu", undefined, "   ");
    await approvePairing({ id: "ada" }, "ABCD-2345", NOW, "project_zedu");
    expect(db.agent.create.mock.calls[0][0].data).not.toHaveProperty("instructions");
    expect(db.agent.create.mock.calls[1][0].data).not.toHaveProperty("instructions");
  });

  it("refuses over-long approved instructions without burning the code (#431)", async () => {
    const result = await approvePairing(
      { id: "ada" },
      "ABCD-2345",
      NOW,
      "project_zedu",
      undefined,
      "x".repeat(AGENT_INSTRUCTIONS_MAX + 1),
    );
    expect(result).toMatchObject({ ok: false });
    expect(db.agentPairing.updateMany).not.toHaveBeenCalled();
    expect(db.agent.create).not.toHaveBeenCalled();
  });

  it("refuses to approve past the owner's agent cap without burning the code (#511)", async () => {
    db.agent.count.mockResolvedValueOnce(MAX_ACTIVE_AGENTS_PER_OWNER);
    const result = await approvePairing({ id: "ada" }, "ABCD-2345", NOW, "project_zedu");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("Revoke one");
    expect(db.agentPairing.updateMany).not.toHaveBeenCalled();
    expect(db.agent.create).not.toHaveBeenCalled();
  });

  it("fails for a used, expired or unknown code", async () => {
    db.agentPairing.updateMany.mockResolvedValue({ count: 0 });
    expect(await approvePairing({ id: "bob" }, "ABCD-2345", NOW, "project_zedu")).toMatchObject({ ok: false });
    expect(await approvePairing({ id: "bob" }, "nonsense", NOW, "project_zedu")).toMatchObject({ ok: false });
  });

  it("approves into the organization the person is in now", async () => {
    db.membership.findUnique.mockResolvedValue({ tenantId: "tenant_ziki" });
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    db.agentPairing.findUnique.mockResolvedValue({ id: "p1", proposedName: "Ada's Claude", proposedModel: null });
    expect(await approvePairing({ id: "ada" }, "ABCD-2345", NOW, "project_web", "tenant_ziki")).toEqual({
      ok: true,
      name: "Ada's Claude",
    });
    expect(db.project.findFirst).toHaveBeenCalledWith({
      where: { id: "project_web", tenantId: "tenant_ziki" },
      select: { id: true },
    });
    expect(db.agentPairing.updateMany.mock.calls[0][0].data.tenantId).toBe("tenant_ziki");
  });

  it("does not approve into an organization they are not in", async () => {
    db.membership.findUnique.mockResolvedValue(null);
    expect(await approvePairing({ id: "ada" }, "ABCD-2345", NOW, "project_web", "tenant_other")).toMatchObject({ ok: false });
    expect(db.agentPairing.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a project outside the workspace without using the code (#742)", async () => {
    db.project.findFirst.mockResolvedValue(null);
    expect(await approvePairing({ id: "ada" }, "ABCD-2345", NOW, "project_other")).toMatchObject({ ok: false });
    expect(db.agentPairing.updateMany).not.toHaveBeenCalled();
  });
});

const approved = {
  id: "p1",
  proposedName: "Ada's Claude",
  proposedModel: "Claude",
  expiresAt: new Date(NOW.getTime() + 60_000),
  approvedAt: NOW,
  consumedAt: null,
  ownerUserId: "ada",
  tenantId: "tenant_zedu",
  projectId: "project_zedu",
};

describe("collectPairing (#427)", () => {
  it("waits until the owner approves", async () => {
    db.agentPairing.findUnique.mockResolvedValue({ ...approved, approvedAt: null, ownerUserId: null, tenantId: null });
    expect(await collectPairing(DEVICE, NOW)).toEqual({ status: "pending" });
  });

  it("reports an unapproved code as expired after 15 minutes", async () => {
    db.agentPairing.findUnique.mockResolvedValue({
      ...approved,
      approvedAt: null,
      ownerUserId: null,
      tenantId: null,
      expiresAt: new Date(NOW.getTime() - 1),
    });
    expect(await collectPairing(DEVICE, NOW)).toEqual({ status: "expired" });
  });

  it("adds the key to the agent created at approval, without creating another agent", async () => {
    db.agentPairing.findUnique.mockResolvedValue({ ...approved, agentId: "agent9" });
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    const result = await collectPairing(DEVICE, NOW);
    expect(result.status).toBe("issued");
    expect(db.agent.create).not.toHaveBeenCalled();
    expect(db.agentApiKey.create.mock.calls[0][0].data).toMatchObject({ agentId: "agent9", projectId: "project_zedu" });
  });

  it("reports the level the agent actually has, if the owner changed it after approval", async () => {
    db.agentPairing.findUnique.mockResolvedValue({ ...approved, agentId: "agent9", proposedLevel: "working" });
    db.agent.findUnique.mockResolvedValue({ level: "manager" });
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    const result = await collectPairing(DEVICE, NOW);
    expect(result.status).toBe("issued");
    if (result.status === "issued") expect(result.key.level).toBe("manager");
  });

  it("creates the agent for the approver at the shared default, and returns its key once", async () => {
    db.agentPairing.findUnique.mockResolvedValue(approved);
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    const result = await collectPairing(DEVICE, NOW);
    expect(result.status).toBe("issued");
    expect(db.agentPairing.updateMany.mock.calls[0][0].where).toEqual({ id: "p1", consumedAt: null });
    expect(db.agent.create.mock.calls[0][0].data).toMatchObject({
      ownerUserId: "ada",
      tenantId: "tenant_zedu",
      name: "Ada's Claude",
      level: DEFAULT_AGENT_LEVEL,
      apiKeys: { create: { projectId: "project_zedu" } },
    });
    expect(db.agentPairing.update.mock.calls[0][0].data).toEqual({ agentId: "agent9" });
  });

  it.each(["manager", "merger"])("rejects an old approved %s pairing that has not created an agent", async (proposedLevel) => {
    db.agentPairing.findUnique.mockResolvedValue({ ...approved, proposedLevel });
    expect(await collectPairing(DEVICE, NOW)).toEqual({ status: "invalid" });
    expect(db.agent.create).not.toHaveBeenCalled();
    expect(db.agentApiKey.create).not.toHaveBeenCalled();
    expect(db.agentPairing.updateMany).not.toHaveBeenCalled();
  });

  it("never issues twice", async () => {
    db.agentPairing.findUnique.mockResolvedValue({ ...approved, consumedAt: NOW });
    expect(await collectPairing(DEVICE, NOW)).toEqual({ status: "used" });
    // Two polls racing past the first check: the guarded update stops one.
    db.agentPairing.findUnique.mockResolvedValue(approved);
    db.agentPairing.updateMany.mockResolvedValue({ count: 0 });
    expect(await collectPairing(DEVICE, NOW)).toEqual({ status: "used" });
    expect(db.agent.create).not.toHaveBeenCalled();
  });

  it("uses the oldest project when an older approval named none, and does not consume it when none exist", async () => {
    db.agentPairing.findUnique.mockResolvedValue({ ...approved, projectId: null });
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    db.project.findFirst.mockResolvedValue({ id: "project_oldest" });
    const issued = await collectPairing(DEVICE, NOW);
    expect(issued.status).toBe("issued");
    expect(db.project.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant_zedu" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    expect(db.agent.create.mock.calls[0][0].data.apiKeys.create.projectId).toBe("project_oldest");

    db.agent.create.mockClear();
    db.agentPairing.updateMany.mockClear();
    db.project.findFirst.mockResolvedValue(null);
    expect(await collectPairing(DEVICE, NOW)).toEqual({ status: "invalid" });
    expect(db.agentPairing.updateMany).not.toHaveBeenCalled();
  });

  it("records an approved agent that was never created because the poll failed", async () => {
    db.agentPairing.findMany.mockResolvedValue([{
      id: "p1",
      proposedName: "Otter",
      proposedModel: "deepseek",
      ownerUserId: "ada",
      tenantId: "tenant_zedu",
    }]);
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    await materializeApprovedPairings("ada", "tenant_zedu");
    expect(db.agent.create.mock.calls[0][0].data).toMatchObject({
      ownerUserId: "ada",
      tenantId: "tenant_zedu",
      name: "Otter",
    });
    expect(db.agentPairing.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", agentId: null },
      data: { agentId: "agent9" },
    });
  });

  it("rejects a missing or malformed device code without a lookup", async () => {
    expect(await collectPairing(undefined, NOW)).toEqual({ status: "invalid" });
    expect(await collectPairing("short", NOW)).toEqual({ status: "invalid" });
    expect(db.agentPairing.findUnique).not.toHaveBeenCalled();
  });
});

describe("cleanupExpiredPairings (#673)", () => {
  it("deletes unapproved and unconsumed pairings that have expired", async () => {
    db.agentPairing.deleteMany.mockResolvedValue({ count: 5 });
    const result = await cleanupExpiredPairings(NOW);
    expect(result).toEqual({ count: 5 });
    expect(db.agentPairing.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lt: NOW },
        approvedAt: null,
        consumedAt: null,
      },
    });
  });

  it("triggers cleanup on startPairing and approvePairing", async () => {
    db.agentPairing.deleteMany.mockResolvedValue({ count: 2 });
    db.agentPairing.updateMany.mockResolvedValue({ count: 1 });
    db.agentPairing.findUnique.mockResolvedValue({
      id: "p1",
      proposedName: "Ada's Claude",
      proposedModel: null,
    });

    await startPairing({ name: "Sweep Agent" }, NOW);
    expect(db.agentPairing.deleteMany).toHaveBeenCalled();

    db.agentPairing.deleteMany.mockClear();
    await approvePairing({ id: "ada" }, "KX7P-2MQD", NOW, "project_zedu");
    expect(db.agentPairing.deleteMany).toHaveBeenCalled();
  });
});
