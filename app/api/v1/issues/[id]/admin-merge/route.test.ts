import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ requireAgent: vi.fn(), budget: vi.fn(), adminMerge: vi.fn() }));
vi.mock("@/lib/agents/require-agent", async (original) => ({
  ...(await original<typeof import("@/lib/agents/require-agent")>()),
  requireAgent: mocks.requireAgent,
}));
vi.mock("@/lib/agents/rate-budget", () => ({
  consumeAgentBudget: mocks.budget,
  agentBudgetExceededResponse: () => new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 }),
}));
vi.mock("@/lib/agent-api/merge", () => ({ executeAdminMerge: mocks.adminMerge }));

import { AgentAuthError } from "@/lib/agents/require-agent";
import { POST } from "./route";

const agent = { agentId: "am1", name: "am1", ownerId: "amo", tenantId: "tenant", level: "merger", burst: false, keyId: "k" };
const params = { params: Promise.resolve({ id: "bug1" }) };

function request(key = true) {
  return new NextRequest("http://localhost/api/v1/issues/bug1/admin-merge", {
    method: "POST",
    headers: key ? { authorization: "Bearer test-key" } : {},
  });
}

describe("POST /api/v1/issues/[id]/admin-merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgent.mockResolvedValue(agent);
    mocks.budget.mockResolvedValue({ allowed: true });
    mocks.adminMerge.mockResolvedValue({ status: 200, accepted: true, merged: true, solverUserId: "ada", rewardedReviewerUserIds: ["rob"] });
  });

  it("charges a write and returns the admin merge summary", async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, merged: true, solverUserId: "ada", rewardedReviewerUserIds: ["rob"] });
    expect(mocks.budget).toHaveBeenCalledWith({ id: "am1", burst: false, burstUntil: null }, "write");
    expect(mocks.adminMerge).toHaveBeenCalledWith(agent, "bug1");
  });

  it("rejects unauthorized request", async () => {
    mocks.requireAgent.mockRejectedValue(new AgentAuthError("missing_key"));
    expect((await POST(request(false), params)).status).toBe(401);
    expect(mocks.adminMerge).not.toHaveBeenCalled();
  });

  it("stops when the write budget is spent", async () => {
    mocks.budget.mockResolvedValue({ allowed: false, retryAfterSeconds: 5 });
    expect((await POST(request(), params)).status).toBe(429);
    expect(mocks.adminMerge).not.toHaveBeenCalled();
  });

  it("forwards error response from executeAdminMerge", async () => {
    mocks.adminMerge.mockResolvedValue({ status: 403, error: "insufficient_level", message: "Only admin merger agents can execute the final merge." });
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "insufficient_level", message: "Only admin merger agents can execute the final merge." });
  });
});
