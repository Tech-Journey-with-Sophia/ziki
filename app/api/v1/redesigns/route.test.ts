import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() }, agentAuditEvent: { create: vi.fn() },
}));
const budget = vi.hoisted(() => vi.fn());
const proposeRedesign = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({
  ...await original<typeof import("@/lib/agents/rate-budget")>(), consumeAgentBudget: budget,
}));
// Keep the real request schema; only the domain write is stubbed (#552 asserts levels).
vi.mock("@/lib/redesigns", async (original) => ({
  ...await original<typeof import("@/lib/redesigns")>(), proposeRedesign,
}));
import { POST } from "./route";

const key = { id: "key-a", revokedAt: null, projectId: "project-a", project: { slug: "app" }, agent: {
  id: "agent-a", name: "Agent A", ownerUserId: "owner-a", tenantId: "tenant-a", level: "working", burst: false, revokedAt: null,
  owner: { memberships: [{ tenantId: "tenant-a" }] },
} };
const body = { projectId: "project-a", title: "Restructure the settings navigation", body: "A proposal body with plenty of detail." };
function request(keyHeader = "Bearer ziki_test", keyLevel = "working") {
  const agent = { ...key.agent, level: keyLevel };
  db.agentApiKey.findUnique.mockResolvedValue({ ...key, agent });
  return new NextRequest("http://localhost/api/v1/redesigns", {
    method: "POST", headers: { authorization: keyHeader, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  budget.mockResolvedValue({ allowed: true });
  db.agentAuditEvent.create.mockResolvedValue({ id: "audit-1" });
  proposeRedesign.mockResolvedValue({ id: "redesign-1", title: body.title, status: "proposed" });
});

describe("POST /api/v1/redesigns levels (#552)", () => {
  it("requires a key before anything else", async () => {
    expect((await POST(new NextRequest("http://localhost/api/v1/redesigns", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }))).status).toBe(401);
    expect(proposeRedesign).not.toHaveBeenCalled();
  });

  it("lets manager and merger agents propose too", async () => {
    expect((await POST(request("Bearer ziki_test", "manager"))).status).toBe(201);
    expect((await POST(request("Bearer ziki_test", "merger"))).status).toBe(201);
    expect(proposeRedesign).toHaveBeenCalledTimes(2);
  });

  it("lets a working agent propose and audits the request", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ proposal: { id: "redesign-1", title: body.title, status: "proposed" } });
    expect(proposeRedesign).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-a" }), expect.objectContaining({ projectId: "project-a", title: body.title }));
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "redesigns.create" }) }));
  });

  it("validates the proposal body without calling the domain write", async () => {
    db.agentApiKey.findUnique.mockResolvedValue({ ...key, agent: { ...key.agent, level: "working" } });
    const invalid = new NextRequest("http://localhost/api/v1/redesigns", {
      method: "POST",
      headers: { authorization: "Bearer ziki_test", "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "project-a", title: "tiny", body: "short" }),
    });
    expect((await POST(invalid)).status).toBe(400);
    expect(proposeRedesign).not.toHaveBeenCalled();
  });
});
