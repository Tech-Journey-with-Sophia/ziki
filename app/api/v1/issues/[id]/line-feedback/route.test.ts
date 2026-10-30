import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  project: { findFirst: vi.fn() },
  bug: { findFirst: vi.fn(), update: vi.fn() },
  comment: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));

const budget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agents/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({
  ...(await original<typeof import("@/lib/agents/rate-budget")>()),
  consumeAgentBudget: budget,
}));

import { GET, POST } from "./route";

const key = {
  id: "key-a",
  revokedAt: null,
  projectId: "proj-1",
  project: { id: "proj-1" },
  agent: {
    id: "agent-a",
    name: "Agent A",
    ownerUserId: "owner-a",
    tenantId: "tenant-a",
    level: "working",
    burst: false,
    revokedAt: null,
    owner: { memberships: [{ tenantId: "tenant-a" }] },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.agentApiKey.findUnique.mockResolvedValue(key);
  db.project.findFirst.mockResolvedValue({ id: "proj-1" });
  budget.mockResolvedValue({ allowed: true });
});

describe("GET /api/v1/issues/[id]/line-feedback", () => {
  it("returns line feedback threads for an agent to read in issue context", async () => {
    db.bug.findFirst.mockResolvedValue({ id: "bug-1", number: 10 });
    db.comment.findMany.mockResolvedValue([
      {
        id: "c-root",
        bugId: "bug-1",
        authorId: "user-1",
        agentId: null,
        parentId: null,
        body: "[Line Feedback: src/index.ts:25 @ abc1234] (status: open)\n\nConsider refactoring.",
        createdAt: new Date("2026-10-30T00:00:00Z"),
        author: { id: "user-1", name: "Reviewer", email: "rev@example.com" },
      },
    ]);

    const req = new NextRequest("http://localhost/api/v1/issues/bug-1/line-feedback?projectId=proj-1", {
      headers: { Authorization: "Bearer ziki_test" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "bug-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lineFeedback).toHaveLength(1);
    expect(data.lineFeedback[0]).toMatchObject({
      filePath: "src/index.ts",
      lineNumber: 25,
      status: "open",
      comment: "Consider refactoring.",
    });
  });
});

describe("POST /api/v1/issues/[id]/line-feedback", () => {
  it("lets an agent reply to a line-level feedback thread and mark it addressed with a commit reference", async () => {
    db.bug.findFirst.mockResolvedValue({ id: "bug-1", number: 10 });
    db.comment.findFirst.mockResolvedValue({
      id: "c-root",
      body: "[Line Feedback: src/index.ts:25 @ abc1234] (status: open)\n\nConsider refactoring.",
    });
    db.comment.create.mockResolvedValue({ id: "c-reply", createdAt: new Date() });
    db.comment.update.mockResolvedValue({ id: "c-root" });

    const req = new NextRequest("http://localhost/api/v1/issues/bug-1/line-feedback?projectId=proj-1", {
      method: "POST",
      headers: { Authorization: "Bearer ziki_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "c-root",
        comment: "Refactored into smaller functions.",
        commitSha: "def5678",
        markAddressed: true,
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "bug-1" }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, replyId: "c-reply", status: "addressed" });
    expect(db.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bugId: "bug-1",
          parentId: "c-root",
          agentId: "agent-a",
        }),
      }),
    );
    expect(db.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-root" },
        data: {
          body: "[Line Feedback: src/index.ts:25 @ abc1234] (status: addressed, addressed in def5678)\n\nConsider refactoring.",
        },
      }),
    );
  });
});
