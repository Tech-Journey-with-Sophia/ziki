import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/lib/agents/require-agent";

const db = vi.hoisted(() => ({
  bug: { findUnique: vi.fn() },
  pointEntry: { createMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { awardIdeaContribution } from "./validation";

const bob: AgentContext = { agentId: "agent-bob", name: "bob", ownerId: "owner-bob", tenantId: "t1", level: "working", burst: false, keyId: "k1" };

const idea = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  tenantId: "t1",
  projectId: "p1",
  title: "Activity as an icon",
  status: "open",
  assigneeId: null,
  voteCount: 0,
  severity: "medium",
  reporterId: "owner-ada",
  beneficiaryUserId: "owner-ada",
  duplicateOfId: null,
  createdByAgentId: "agent-ada",
  createdByAgent: { ownerUserId: "owner-ada" },
  claims: [],
  ...overrides,
});

describe("awardIdeaContribution", () => {
  beforeEach(() => {
    db.bug.findUnique.mockReset();
    db.pointEntry.createMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("pays the agent's owner 1 point, keyed once per person per idea", async () => {
    db.bug.findUnique.mockResolvedValue(idea());
    expect(await awardIdeaContribution(bob, "b1")).toBe(true);
    expect(db.pointEntry.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: "t1", userId: "owner-bob", bugId: "b1", role: "idea", points: 1, sourceKey: "idea:b1:owner-bob" }],
      skipDuplicates: true,
    });
  });

  it("pays nothing on the owner's own idea", async () => {
    db.bug.findUnique.mockResolvedValue(idea({ reporterId: "owner-bob", beneficiaryUserId: "owner-bob", createdByAgent: { ownerUserId: "owner-bob" } }));
    expect(await awardIdeaContribution(bob, "b1")).toBe(false);
    expect(db.pointEntry.createMany).not.toHaveBeenCalled();
  });

  it("pays nothing once the issue is closed or no longer an idea", async () => {
    db.bug.findUnique.mockResolvedValue(idea({ status: "resolved" }));
    expect(await awardIdeaContribution(bob, "b1")).toBe(false);
    db.bug.findUnique.mockResolvedValue(idea());
    expect(await awardIdeaContribution(bob, "b1", { wasIdea: false })).toBe(false);
    expect(db.pointEntry.createMany).not.toHaveBeenCalled();
  });

  it("never fails the write it follows", async () => {
    db.bug.findUnique.mockRejectedValue(new Error("db down"));
    await expect(awardIdeaContribution(bob, "b1")).resolves.toBe(false);
  });
});
