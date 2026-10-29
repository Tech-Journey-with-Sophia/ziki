import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  agentEvent: { create: vi.fn(), findUnique: vi.fn() },
  webhookSubscription: { findMany: vi.fn() },
  project: { findFirst: vi.fn() },
  agentMistake: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
}));
const budget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({
  ...(await original<typeof import("@/lib/agents/rate-budget")>()),
  consumeAgentBudget: budget,
}));

import { GET, POST } from "./route";

function makeKey(level: "working" | "manager" | "merger" = "manager") {
  return {
    id: `key-${level}`,
    revokedAt: null,
    projectId: "proj-1",
    project: { slug: "web" },
    agent: {
      id: `agent-${level}`,
      name: `Agent ${level}`,
      ownerUserId: "owner-1",
      tenantId: "tenant-1",
      level,
      burst: false,
      revokedAt: null,
      owner: { memberships: [{ tenantId: "tenant-1" }] },
    },
  };
}

function request(url: string, method = "GET", body?: unknown, keyHeader = "Bearer ziki_test") {
  return new NextRequest(url, {
    method,
    headers: {
      ...(keyHeader ? { authorization: keyHeader } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/v1/projects/[id]/mistakes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    budget.mockResolvedValue({ allowed: true });
    db.project.findFirst.mockResolvedValue({ id: "proj-1" });
    db.agentEvent.create.mockResolvedValue({ id: "e1" });
    db.webhookSubscription.findMany.mockResolvedValue([]);
  });

  it("lists project mistakes for any working agent", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(makeKey("working"));
    db.agentMistake.findMany.mockResolvedValue([
      {
        id: "m-1",
        title: "Missing error handling",
        category: "correctness",
        antiPattern: "Unhandled promises fail silently.",
        remediation: "Always catch promise errors.",
        recurrenceCount: 1,
      },
    ]);

    const context = { params: Promise.resolve({ id: "proj-1" }) };
    const res = await GET(request("http://localhost/api/v1/projects/proj-1/mistakes?category=correctness"), context);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mistakes).toHaveLength(1);
    expect(body.mistakes[0].title).toBe("Missing error handling");
  });
});

describe("POST /api/v1/projects/[id]/mistakes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    budget.mockResolvedValue({ allowed: true });
    db.project.findFirst.mockResolvedValue({ id: "proj-1" });
    db.agentEvent.create.mockResolvedValue({ id: "e1" });
    db.webhookSubscription.findMany.mockResolvedValue([]);
  });

  it("rejects working agents with 403: recording a mistake needs a manager agent", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(makeKey("working"));
    const context = { params: Promise.resolve({ id: "proj-1" }) };
    const res = await POST(
      request("http://localhost/api/v1/projects/proj-1/mistakes", "POST", {
        title: "Missing test coverage",
        antiPattern: "Submitted without unit tests.",
        remediation: "Always add tests.",
      }),
      context,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("insufficient_level");
  });

  it("creates a new mistake when a manager agent posts valid input", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(makeKey("manager"));
    db.agentMistake.findFirst.mockResolvedValue(null);
    db.agentMistake.create.mockResolvedValue({
      id: "m-new",
      title: "Missing test coverage",
      category: "correctness",
      antiPattern: "Submitted without unit tests.",
      remediation: "Always add tests covering edge cases.",
      recurrenceCount: 1,
    });

    const context = { params: Promise.resolve({ id: "proj-1" }) };
    const res = await POST(
      request("http://localhost/api/v1/projects/proj-1/mistakes", "POST", {
        category: "correctness",
        title: "Missing test coverage",
        antiPattern: "Submitted without unit tests.",
        remediation: "Always add tests covering edge cases.",
      }),
      context,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mistake.id).toBe("m-new");
  });
});
