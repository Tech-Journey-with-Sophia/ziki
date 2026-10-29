import { beforeEach, describe, expect, it, vi } from "vitest";
import { removeUpvote, upvoteIssue } from "./votes";

const bugId = "bug-1";
const projectId = "project-1";

const db = vi.hoisted(() => ({
  bug: { findUnique: vi.fn(), update: vi.fn() },
  vote: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), groupBy: vi.fn() },
  agentEvent: { create: vi.fn(), findUnique: vi.fn() },
  webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

const agent = {
  agentId: "agent-1",
  name: "Ada",
  ownerId: "user-ada",
  tenantId: "tenant-zedu",
  level: "working" as const,
  burst: false,
  keyId: "key-1",
};

describe("agent upvotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
    db.$queryRaw.mockResolvedValue([{ id: bugId }]);
    db.agentEvent.create.mockResolvedValue({ id: "evt-1" });
    db.agentEvent.findUnique.mockResolvedValue({ id: "evt-1" });
    db.webhookSubscription.findMany.mockResolvedValue([]);
    db.bug.update.mockResolvedValue({});
    db.vote.groupBy.mockResolvedValue([{ value: 1, _count: { _all: 1 } }]);
  });

  it("records the owner upvote once and publishes it", async () => {
    db.vote.findUnique.mockResolvedValue(null);
    db.vote.create.mockResolvedValue({ id: "vote-1" });

    const result = await upvoteIssue(agent, projectId, bugId);

    expect(result).toEqual({ voted: true, voteCount: 1, changed: true });
    expect(db.vote.create).toHaveBeenCalledWith({
      data: { userId: "user-ada", bugId, value: 1 },
    });
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: bugId }, data: { voteCount: 1 } });
    expect(db.agentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "issue.voted",
        actorAgentId: "agent-1",
        bugId,
        payload: expect.objectContaining({ userId: "user-ada", voteCount: 1, voted: true }),
      }),
    }));
  });

  it("does not add a second upvote when the owner already voted", async () => {
    db.vote.findUnique.mockResolvedValue({ id: "vote-1", value: 1 });
    db.bug.findUnique.mockResolvedValue({ voteCount: 3 });

    const result = await upvoteIssue(agent, projectId, bugId);

    expect(result).toEqual({ voted: true, voteCount: 3, changed: false });
    expect(db.vote.create).not.toHaveBeenCalled();
    expect(db.agentEvent.create).not.toHaveBeenCalled();
  });

  it("turns an old downvote into an upvote", async () => {
    db.vote.findUnique.mockResolvedValue({ id: "vote-1", value: -1 });
    db.vote.update.mockResolvedValue({});

    const result = await upvoteIssue(agent, projectId, bugId);

    expect(result.changed).toBe(true);
    expect(db.vote.update).toHaveBeenCalledWith({ where: { id: "vote-1" }, data: { value: 1 } });
  });

  it("removes the owner upvote and recounts", async () => {
    db.vote.findUnique.mockResolvedValue({ id: "vote-1", value: 1 });
    db.vote.groupBy.mockResolvedValue([]);

    const result = await removeUpvote(agent, projectId, bugId);

    expect(result).toEqual({ voted: false, voteCount: 0, changed: true });
    expect(db.vote.delete).toHaveBeenCalledWith({ where: { id: "vote-1" } });
    expect(db.agentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "issue.voted",
        payload: expect.objectContaining({ voted: false, voteCount: 0 }),
      }),
    }));
  });

  it("leaves the count alone when the owner has no upvote", async () => {
    db.vote.findUnique.mockResolvedValue(null);
    db.bug.findUnique.mockResolvedValue({ voteCount: 2 });

    const result = await removeUpvote(agent, projectId, bugId);

    expect(result).toEqual({ voted: false, voteCount: 2, changed: false });
    expect(db.vote.delete).not.toHaveBeenCalled();
  });
});
