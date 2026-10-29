import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    testMission: {
      createMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    tx,
    prisma: {
      testMission: { createMany: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { prisma } from "@/lib/prisma";
import {
  createMissionSchema,
  createTestMissions,
  coverTestMission,
  MISSION_LEASE_MS,
  nextTestMission,
} from "@/lib/missions";

const agent = {
  agentId: "agent-1",
  ownerId: "owner-1",
  tenantId: "tenant-1",
  level: "working" as const,
  burst: false,
  keyId: "key-1",
  name: "Tester",
};

const tx = mocks.tx;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
    callback(tx as never),
  );
});

describe("test mission setup (#619)", () => {
  it("validates route-only missions and rejects full URLs or traversal", () => {
    const valid = {
      routePattern: "/settings/**",
      brief: "Check settings",
      roles: ["admin", "member"],
      viewports: ["desktop", "mobile_375"],
    };
    expect(createMissionSchema.safeParse(valid).success).toBe(true);
    expect(createMissionSchema.safeParse({ ...valid, routePattern: "https://example.com" }).success).toBe(false);
    expect(createMissionSchema.safeParse({ ...valid, routePattern: "/../private" }).success).toBe(false);
    expect(createMissionSchema.safeParse({ ...valid, roles: [] }).success).toBe(false);
  });

  it("creates the selected role and viewport combinations and skips duplicates", async () => {
    mocks.prisma.testMission.createMany.mockResolvedValue({ count: 3 });
    const result = await createTestMissions("project-1", {
      routePattern: " /settings/** ",
      brief: " Check settings ",
      roles: ["member", "signed_out"],
      viewports: ["desktop", "mobile_375"],
    });

    expect(result.count).toBe(3);
    expect(mocks.prisma.testMission.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: "project-1", routePattern: "/settings/**", brief: "Check settings", role: "member", viewport: "desktop" },
        { projectId: "project-1", routePattern: "/settings/**", brief: "Check settings", role: "member", viewport: "mobile_375" },
        { projectId: "project-1", routePattern: "/settings/**", brief: "Check settings", role: "signed_out", viewport: "desktop" },
        { projectId: "project-1", routePattern: "/settings/**", brief: "Check settings", role: "signed_out", viewport: "mobile_375" },
      ],
      skipDuplicates: true,
    });
  });
});

describe("agent mission distribution (#619)", () => {
  it("returns an agent's unexpired assignment instead of giving it another", async () => {
    const current = { id: "mission-1", leaseExpiresAt: new Date(Date.now() + 1000) };
    tx.testMission.findFirst.mockResolvedValueOnce(current);

    await expect(nextTestMission(agent, "project-1")).resolves.toBe(current);
    expect(tx.testMission.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.testMission.update).not.toHaveBeenCalled();
  });

  it("prefers an uncovered mission last assigned to a different owner", async () => {
    const candidate = { id: "mission-2", projectId: "project-1" };
    const assigned = { ...candidate, leaseAgentId: agent.agentId };
    tx.testMission.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(candidate);
    tx.testMission.update.mockResolvedValueOnce(assigned);

    await expect(nextTestMission(agent, "project-1")).resolves.toBe(assigned);
    expect(tx.testMission.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        projectId: "project-1",
        AND: [{ OR: [{ lastAssignedOwnerId: null }, { lastAssignedOwnerId: { not: agent.ownerId } }] }],
      }),
      orderBy: [
        { lastCoveredAt: { sort: "asc", nulls: "first" } },
        { lastAssignedAt: { sort: "asc", nulls: "first" } },
        { id: "asc" },
      ],
    }));
    expect(tx.testMission.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: candidate.id },
      data: expect.objectContaining({
        lastAssignedOwnerId: agent.ownerId,
        leaseAgentId: agent.agentId,
        leaseOwnerId: agent.ownerId,
        leaseExpiresAt: expect.any(Date),
      }),
    }));
    const leaseExpiresAt = tx.testMission.update.mock.calls[0][0].data.leaseExpiresAt as Date;
    expect(leaseExpiresAt.getTime()).toBeGreaterThan(Date.now() + MISSION_LEASE_MS - 2000);
  });

  it("falls back to the least-covered mission when the preferred owner slice is empty", async () => {
    const candidate = { id: "mission-3" };
    tx.testMission.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(candidate);
    tx.testMission.update.mockResolvedValueOnce(candidate);

    await expect(nextTestMission(agent, "project-1")).resolves.toBe(candidate);
    expect(tx.testMission.findFirst).toHaveBeenCalledTimes(3);
    expect(tx.testMission.findFirst).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: { projectId: "project-1", OR: [{ leaseAgentId: null }, { leaseExpiresAt: { lte: expect.any(Date) } }] },
    }));
  });

  it("reports no available mission when every route is leased", async () => {
    tx.testMission.findFirst.mockResolvedValue(null);
    await expect(nextTestMission(agent, "project-1")).resolves.toBeNull();
    expect(tx.testMission.update).not.toHaveBeenCalled();
  });

  it("records coverage and releases the active lease", async () => {
    tx.testMission.findFirst.mockResolvedValueOnce({ id: "mission-1" });
    tx.testMission.update.mockResolvedValueOnce({ id: "mission-1" });

    await expect(coverTestMission(agent, "project-1", "mission-1", 2)).resolves.toBe(true);
    expect(tx.testMission.update).toHaveBeenCalledWith({
      where: { id: "mission-1" },
      data: {
        lastCoveredAt: expect.any(Date),
        issuesFiled: { increment: 2 },
        leaseAgentId: null,
        leaseOwnerId: null,
        leaseExpiresAt: null,
      },
    });
  });

  it("does not let another agent or an expired lease report coverage", async () => {
    tx.testMission.findFirst.mockResolvedValueOnce(null);
    await expect(coverTestMission(agent, "project-1", "mission-1", 0)).resolves.toBe(false);
    expect(tx.testMission.update).not.toHaveBeenCalled();
  });
});
