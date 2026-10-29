import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

const publishWebEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/agent-api/web-events", () => ({ publishWebEvent }));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantIdFor: vi.fn(async () => "tenant-zedu"),
  bugInTenant: vi.fn((tenantId) => ({ tenantId })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyLater: vi.fn() }));
vi.mock("@/lib/session-user", () => ({ resolveSessionUserId: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({
  requireUser: vi.fn(async () => ({ id: "admin-1", role: "admin" })),
}));
vi.mock("@/lib/tenant-access", () => ({
  currentTenantAccess: vi.fn(async () => ({
    tenantId: "tenant-zedu",
    membershipRole: "admin",
    admin: true,
  })),
}));

const tx = {
  bug: { update: vi.fn(async () => ({})) },
  issueClaim: { updateMany: vi.fn(async () => ({ count: 1 })) },
  attachment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  bugActivity: { create: vi.fn(async () => ({})) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bug: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  },
}));

import { prisma } from "@/lib/prisma";
import { deleteBugAction } from "./issues";

describe("deleteBugAction (#627)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("releases active and offered claims when soft-deleting an issue", async () => {
    vi.mocked(prisma.bug.findUnique).mockResolvedValueOnce({
      id: "bug-1",
      isDeleted: false,
    } as never);

    await deleteBugAction("bug-1");

    expect(tx.bug.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bug-1" },
        data: expect.objectContaining({ isDeleted: true }),
      })
    );

    expect(tx.issueClaim.updateMany).toHaveBeenCalledWith({
      where: {
        bugId: "bug-1",
        releasedAt: null,
        status: { in: ["active", "offered"] },
      },
      data: expect.objectContaining({
        status: "released",
        releaseReason: "deleted",
      }),
    });
  });
});
