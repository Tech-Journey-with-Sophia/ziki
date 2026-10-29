import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  pointEntry: { findMany: vi.fn() },
}));
const budget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({
  ...await original<typeof import("@/lib/agents/rate-budget")>(),
  consumeAgentBudget: budget,
}));

import { GET } from "./route";

function key(level = "working") {
  return {
    id: "key-a",
    revokedAt: null,
    agent: {
      id: "agent-a",
      name: "Ada's Claude",
      ownerUserId: "ada",
      tenantId: "tenant-zedu",
      level,
      burst: false,
      revokedAt: null,
      owner: { memberships: [{ tenantId: "tenant-zedu" }] },
    },
  };
}

function request(query = "", hasKey = true) {
  return new NextRequest(`http://localhost/api/v1/agents/me/points/entries${query}`, {
    headers: { ...(hasKey ? { authorization: "Bearer ziki_test-key" } : {}) },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  db.agentApiKey.findUnique.mockResolvedValue(key());
  budget.mockResolvedValue({ allowed: true });
  db.pointEntry.findMany.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET points entries (#461)", () => {
  it("rejects missing and invalid credentials before reading entries", async () => {
    expect((await GET(request("", false))).status).toBe(401);
    db.agentApiKey.findUnique.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    expect(db.pointEntry.findMany).not.toHaveBeenCalled();
  });
  it("returns only the authenticated owner's tenant-scoped ledger and no-store headers", async () => {
    const response = await GET(request("?userId=someone-else"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user_id: "ada", tenant_id: "tenant-zedu", items: [], nextCursor: null });
    expect(db.pointEntry.findMany.mock.calls[0][0].where).toEqual({ tenantId: "tenant-zedu", userId: "ada" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(budget).toHaveBeenCalledWith(expect.objectContaining({ id: "agent-a" }), "read");
  });
  it.each(["?from=no", "?from=2026-10-23&to=2026-10-22", "?limit=0", "?cursor=invalid"])("rejects %s without reading the ledger", async query => {
    expect((await GET(request(query))).status).toBe(400);
    expect(db.pointEntry.findMany).not.toHaveBeenCalled();
  });
  it("enforces the read budget", async () => {
    budget.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });
    expect((await GET(request())).status).toBe(429);
    expect(db.pointEntry.findMany).not.toHaveBeenCalled();
  });
});
