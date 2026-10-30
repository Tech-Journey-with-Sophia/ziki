import { describe, expect, it, vi } from "vitest";
import {
  formatLineFeedbackBody,
  formatLineReplyBody,
  isLineFeedbackBody,
  loadLineFeedbackThreads,
  parseLineFeedbackBody,
  parseLineReplyBody,
} from "./pull-request-line-feedback";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: {
    comment: { findMany },
  },
}));

describe("pull-request-line-feedback formatting and parsing", () => {
  it("formats and parses a line feedback body correctly", () => {
    const formatted = formatLineFeedbackBody({
      filePath: "lib/auth.ts",
      lineNumber: 42,
      side: "RIGHT",
      commitSha: "abc1234567",
      status: "open",
      comment: "Please check null handling here.",
    });

    expect(isLineFeedbackBody(formatted)).toBe(true);
    const parsed = parseLineFeedbackBody(formatted);
    expect(parsed).toEqual({
      filePath: "lib/auth.ts",
      lineNumber: 42,
      commitSha: "abc1234",
      status: "open",
      addressedCommitSha: null,
      comment: "Please check null handling here.",
    });
  });

  it("formats and parses an addressed line feedback body with commit reference", () => {
    const formatted = formatLineFeedbackBody({
      filePath: "app/page.tsx",
      lineNumber: 10,
      commitSha: "1111111",
      status: "addressed",
      addressedCommitSha: "2222222",
      comment: "Updated styling.",
    });

    const parsed = parseLineFeedbackBody(formatted);
    expect(parsed?.status).toBe("addressed");
    expect(parsed?.addressedCommitSha).toBe("2222222");
    expect(parsed?.comment).toBe("Updated styling.");
  });

  it("formats and parses line feedback replies with commit references", () => {
    const reply = formatLineReplyBody("Fixed as requested.", "fedcba98");
    const parsed = parseLineReplyBody(reply);
    expect(parsed.commitSha).toBe("fedcba9");
    expect(parsed.comment).toBe("Fixed as requested.");
  });

  it("loads and structures line feedback threads and replies from comments", async () => {
    findMany.mockResolvedValue([
      {
        id: "c1",
        bugId: "bug-1",
        authorId: "user-1",
        agentId: null,
        parentId: null,
        body: formatLineFeedbackBody({
          filePath: "lib/db.ts",
          lineNumber: 88,
          status: "open",
          comment: "Use a transaction here.",
        }),
        createdAt: new Date("2026-10-30T00:00:00Z"),
        author: { id: "user-1", name: "Alice", email: "alice@example.com" },
      },
      {
        id: "c2",
        bugId: "bug-1",
        authorId: "user-agent",
        agentId: "agent-1",
        parentId: "c1",
        body: formatLineReplyBody("Wrapped in prisma.$transaction.", "abc9999"),
        createdAt: new Date("2026-10-30T01:00:00Z"),
        author: { id: "user-agent", name: "Agent Worker", email: "agent@example.com" },
      },
      {
        id: "c3",
        bugId: "bug-1",
        authorId: "user-1",
        agentId: null,
        parentId: null,
        body: "A regular comment without line feedback.",
        createdAt: new Date("2026-10-30T02:00:00Z"),
        author: { id: "user-1", name: "Alice", email: "alice@example.com" },
      },
    ]);

    const threads = await loadLineFeedbackThreads("bug-1");
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      id: "c1",
      filePath: "lib/db.ts",
      lineNumber: 88,
      status: "open",
      comment: "Use a transaction here.",
      authorName: "Alice",
    });
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0]).toMatchObject({
      id: "c2",
      threadId: "c1",
      comment: "Wrapped in prisma.$transaction.",
      commitSha: "abc9999",
      agentId: "agent-1",
    });
  });
});
