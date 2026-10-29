import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { agentNotesActor, addNoteComment, listNoteComments, readProjectNotes, restoreProjectNotes,
  saveProjectNotes, voteNoteComment, type NotesActor } from "./project-notes";
import type { AgentContext } from "@/lib/agents/require-agent";

// Opt-in only: run against the task's disposable PostgreSQL, never a demo DB.
const enabled = process.env.NOTES_INTEGRATION_TEST === "true";
describe.runIf(enabled)("project notes PostgreSQL concurrency", () => {
  const suffix = randomUUID();
  let tenantId: string;
  let userId: string;
  let agentId: string;
  const projectIds: string[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.port !== "55479" || url.pathname !== "/notes_test") {
      throw new Error("Notes integration tests require the disposable notes_test database on port 55479.");
    }
    const user = await prisma.user.create({ data: { name: "Notes test owner", email: `notes-${suffix}@example.test`, passwordHash: "test-only" } });
    userId = user.id;
    const tenant = await prisma.tenant.create({ data: { slug: `notes-${suffix}`, name: "Notes integration" } });
    tenantId = tenant.id;
    await prisma.membership.create({ data: { tenantId, userId, role: "owner" } });
    const agent = await prisma.agent.create({ data: { tenantId, ownerUserId: userId, name: "Notes integration agent", level: "working" } });
    agentId = agent.id;
  });
  afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
  async function fixture(): Promise<NotesActor> {
    const project = await prisma.project.create({ data: { tenantId, slug: `project-${projectIds.length}`, name: "Notes project" } });
    projectIds.push(project.id);
    const agent: AgentContext = { agentId, ownerId: userId, tenantId, name: "Notes integration agent", level: "working", keyId: "test", projectId: project.id, burst: false };
    return agentNotesActor(agent, project.id);
  }
  const initial = { body: "Use migrations only.", reason: "Initial guidance", expectedVersion: 0 };
  it("allows exactly one concurrent first creation and keeps one matching revision", async () => {
    const actor = await fixture();
    const results = await Promise.allSettled([saveProjectNotes(actor, initial), saveProjectNotes(actor, { ...initial, body: "Another draft" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const notes = await readProjectNotes(actor);
    const history = await prisma.projectNoteRevision.findMany({ where: { projectId: actor.projectId } });
    expect(history).toHaveLength(1);
    expect(history[0].body).toBe(notes.notes?.body);
  });
  it("allows one stale-version contender and restores an earlier version without history loss", async () => {
    const actor = await fixture();
    await saveProjectNotes(actor, initial);
    const results = await Promise.allSettled(["First edit", "Second edit"].map((body) => saveProjectNotes(actor, { body, expectedVersion: 1, reason: "Concurrent edit" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const original = await prisma.projectNoteRevision.findUniqueOrThrow({ where: { projectId_version: { projectId: actor.projectId, version: 1 } } });
    await restoreProjectNotes(actor, original.id, { expectedVersion: 2, reason: "Restore initial guidance" });
    expect((await readProjectNotes(actor)).notes).toMatchObject({ version: 3, body: initial.body });
    expect(await prisma.projectNoteRevision.count({ where: { projectId: actor.projectId } })).toBe(3);
  });
  it("deduplicates concurrent votes and never promotes a comment", async () => {
    const actor = await fixture();
    await saveProjectNotes(actor, initial);
    const { comment } = await addNoteComment(actor, { body: "A suggested correction" });
    await Promise.all(Array.from({ length: 4 }, () => voteNoteComment(actor, comment.id, true)));
    expect(await prisma.projectNoteCommentVote.count({ where: { commentId: comment.id } })).toBe(1);
    expect((await readProjectNotes(actor)).version).toBe(1);
    expect((await readProjectNotes(actor)).notes?.body).toBe(initial.body);
    await voteNoteComment(actor, comment.id, false);
    await voteNoteComment(actor, comment.id, false);
    expect(await prisma.projectNoteCommentVote.count({ where: { commentId: comment.id } })).toBe(0);
  });
  it("paginates equal-timestamp comments without missing or repeating rows", async () => {
    const actor = await fixture();
    const at = new Date("2026-10-28T06:00:00Z");
    await prisma.projectNoteComment.createMany({ data: ["a", "b", "c"].map((id) => ({ id: `${suffix}-${id}`, projectId: actor.projectId, agentId, ownerId: userId, authorName: "Agent", body: id, createdAt: at })) });
    const first = await listNoteComments(actor, new URLSearchParams({ limit: "2" }));
    const second = await listNoteComments(actor, new URLSearchParams({ limit: "2", cursor: first.nextCursor! }));
    expect([...first.items, ...second.items].map((row) => row.body)).toEqual(["a", "b", "c"]);
    expect(second.nextCursor).toBeNull();
  });
  it("rolls back official notes if the required agent audit cannot be recorded", async () => {
    const actor = await fixture();
    const invalid = { ...actor, agent: { ...actor.agent!, agentId: "missing-agent" } };
    await expect(saveProjectNotes(invalid, initial)).rejects.toThrow();
    expect((await readProjectNotes(actor)).notes).toBeNull();
    expect(await prisma.projectNoteRevision.count({ where: { projectId: actor.projectId } })).toBe(0);
  });
});
