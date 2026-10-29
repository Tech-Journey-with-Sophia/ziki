import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn(), update: vi.fn() }, agentAuditEvent: { create: vi.fn() },
  project: { findFirst: vi.fn() }, membership: { findUnique: vi.fn() },
  projectNotes: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  projectNoteComment: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  projectNoteRevision: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  projectNoteCommentVote: { createMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() }, $transaction: vi.fn(),
}));
const budget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({ ...(await original<typeof import("@/lib/agents/rate-budget")>()), consumeAgentBudget: budget }));
import { GET, PUT, POST as unsupported, OPTIONS } from "./route";
import { GET as comments, POST as comment } from "./comments/route";
import { PUT as vote, DELETE as unvote } from "./comments/[commentId]/upvote/route";
import { GET as revisions } from "./revisions/route";
import { POST as restore } from "./revisions/[revisionId]/restore/route";

function key(level = "working", projectId = "project") {
  return { id: "key", lastUsedAt: new Date(), revokedAt: null, projectId, project: { slug: "ziki" },
    agent: { id: "agent", name: "Worker", ownerUserId: "owner", tenantId: "tenant", level, burst: false, revokedAt: null,
      owner: { role: "user", memberships: [{ tenantId: "tenant" }] } } };
}
const context = { params: Promise.resolve({ id: "project", commentId: "comment", revisionId: "revision" }) };
function request(method = "GET", body?: unknown, auth = true, query = "") {
  return new NextRequest(`https://ziki.dev/api/v1/projects/project/notes${query}`, {
    method, headers: { ...(auth ? { authorization: "Bearer ziki_test" } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const input = { body: "Project conventions", expectedVersion: 0, reason: "Initial" };
const handlers = [GET, PUT, comments, comment, vote, unvote, revisions, restore];
beforeEach(() => {
  vi.resetAllMocks();
  db.agentApiKey.findUnique.mockResolvedValue(key());
  db.project.findFirst.mockResolvedValue({ id: "project" });
  db.membership.findUnique.mockResolvedValue({ role: "member" });
  db.projectNotes.findUnique.mockResolvedValue(null);
  db.projectNotes.findUniqueOrThrow.mockResolvedValue({ version: 1, body: input.body });
  db.projectNoteComment.findMany.mockResolvedValue([]);
  db.projectNoteComment.create.mockResolvedValue({ id: "comment" });
  db.projectNoteComment.findFirst.mockResolvedValue({ id: "comment" });
  db.projectNoteRevision.findMany.mockResolvedValue([]);
  db.projectNoteRevision.create.mockResolvedValue({ id: "revision" });
  db.projectNoteCommentVote.count.mockResolvedValue(1);
  db.$transaction.mockImplementation((run) => run(db));
  budget.mockResolvedValue({ allowed: true, limit: 600, remaining: 599, resetSeconds: 60, budget: "read" });
});

describe("project notes API security and HTTP contract", () => {
  it.each(handlers)("authenticates every endpoint", async (handler) => {
    expect((await handler(request("GET", undefined, false), context)).status).toBe(401);
    expect(db.project.findFirst).not.toHaveBeenCalled();
  });
  it.each(handlers)("rejects a foreign project key on every endpoint", async (handler) => {
    db.agentApiKey.findUnique.mockResolvedValue(key("working", "foreign"));
    expect((await handler(request(), context)).status).toBe(403);
  });
  it("lets working agents read notes, comments and revisions with private responses", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(key("working"));
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notes: null, version: 0, canEdit: false });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await comments(request(), context)).status).toBe(200);
    expect((await revisions(request(), context)).status).toBe(200);
  });
  it("blocks ordinary official-note edits and restoration before reading the payload", async () => {
    expect((await PUT(request("PUT", input), context)).status).toBe(403);
    expect((await restore(request("POST", { expectedVersion: 1, reason: "Restore" }), context)).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each([comment, vote, unvote])("lets any working agent contribute discussion", async (handler) => {
    db.agentApiKey.findUnique.mockResolvedValue(key("working"));
    expect([200, 201]).toContain((await handler(request("POST", { body: "Text" }), context)).status);
  });
  it("allows an owner agent to create official notes and charges a write", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "owner" });
    const response = await PUT(request("PUT", input), context);
    expect(response.status).toBe(200);
    expect(budget).toHaveBeenCalledWith(expect.objectContaining({ id: "agent" }), "write");
    expect(db.projectNoteRevision.create).toHaveBeenCalled();
  });
  it("allows an existing admin merger to edit", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(key("merger"));
    expect((await PUT(request("PUT", input), context)).status).toBe(200);
  });
  it("returns 400 for malformed JSON and invalid input", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "admin" });
    const broken = new NextRequest("https://ziki.dev/api/v1/projects/project/notes", { method: "PUT", headers: { authorization: "Bearer ziki_test" }, body: "{" });
    expect((await PUT(broken, context)).status).toBe(400);
    expect((await PUT(request("PUT", { body: "" }), context)).status).toBe(400);
    expect((await comment(request("POST", { body: " " }), context)).status).toBe(400);
  });
  it("returns 409 for stale edits", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "admin" });
    db.projectNotes.updateMany.mockResolvedValue({ count: 0 });
    expect((await PUT(request("PUT", { ...input, expectedVersion: 2 }), context)).status).toBe(409);
  });
  it("returns 404 for missing or inaccessible resources", async () => {
    db.project.findFirst.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(404);
    db.projectNoteComment.findFirst.mockResolvedValue(null);
    expect((await vote(request("PUT"), context)).status).toBe(404);
    db.membership.findUnique.mockResolvedValue({ role: "owner" });
    db.projectNoteRevision.findFirst.mockResolvedValue(null);
    expect((await restore(request("POST", { expectedVersion: 1, reason: "Restore" }), context)).status).toBe(404);
  });
  it("validates pagination rather than returning an unbounded list", async () => {
    expect((await comments(request("GET", undefined, true, "?limit=101"), context)).status).toBe(400);
    expect((await revisions(request("GET", undefined, true, "?cursor=invalid!"), context)).status).toBe(400);
  });
  it("creates comments and supports idempotent vote methods", async () => {
    expect((await comment(request("POST", { body: "Reusable lesson" }), context)).status).toBe(201);
    expect((await vote(request("PUT"), context)).status).toBe(200);
    expect((await unvote(request("DELETE"), context)).status).toBe(200);
    expect(db.projectNotes.create).not.toHaveBeenCalled();
  });
  it("restores as a new version", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "owner" });
    db.projectNotes.updateMany.mockResolvedValue({ count: 1 });
    db.projectNoteRevision.findFirst.mockResolvedValue({ version: 1, body: "Original" });
    const response = await restore(request("POST", { expectedVersion: 2, reason: "Correct mistake" }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).version).toBe(3);
  });
  it("reports service failures without exposing database details", async () => {
    db.projectNotes.findUnique.mockRejectedValue(new Error("private database connection details"));
    const response = await GET(request(), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database");
  });
  it("honors the shared request budget", async () => {
    budget.mockResolvedValue({ allowed: false, retryAfterSeconds: 60, limit: 30, remaining: 0, resetSeconds: 60, budget: "write" });
    expect((await comment(request("POST", { body: "Text" }), context)).status).toBe(429);
    expect(db.projectNoteComment.create).not.toHaveBeenCalled();
  });
  it("documents supported methods", async () => {
    expect((await unsupported(request("POST"))).status).toBe(405);
    expect((await OPTIONS()).headers.get("Allow")).toContain("PUT");
  });
});
