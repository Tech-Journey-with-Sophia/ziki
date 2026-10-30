import { prisma } from "@/lib/prisma";

export interface LineFeedbackThread {
  id: string;
  bugId: string;
  filePath: string;
  lineNumber: number;
  side: "LEFT" | "RIGHT";
  commitSha: string | null;
  status: "open" | "addressed" | "resolved";
  addressedCommitSha: string | null;
  comment: string;
  authorId: string;
  authorName: string;
  agentId: string | null;
  createdAt: string;
  replies: LineFeedbackReply[];
}

export interface LineFeedbackReply {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  agentId: string | null;
  comment: string;
  commitSha: string | null;
  createdAt: string;
}

export function isLineFeedbackBody(body: string): boolean {
  return body.startsWith("[Line Feedback:");
}

export function formatLineFeedbackBody(params: {
  filePath: string;
  lineNumber: number;
  side?: "LEFT" | "RIGHT";
  commitSha?: string | null;
  status?: "open" | "addressed" | "resolved";
  addressedCommitSha?: string | null;
  comment: string;
}): string {
  const { filePath, lineNumber, commitSha, status = "open", addressedCommitSha, comment } = params;
  const shaTag = commitSha ? ` @ ${commitSha.slice(0, 7)}` : "";
  const addressedTag = addressedCommitSha ? `, addressed in ${addressedCommitSha.slice(0, 7)}` : "";
  return `[Line Feedback: ${filePath}:${lineNumber}${shaTag}] (status: ${status}${addressedTag})\n\n${comment.trim()}`;
}

export function parseLineFeedbackBody(body: string) {
  const match = /^\[Line Feedback:\s*([^:\s]+):(\d+)(?:\s*@\s*([a-f0-9]+))?\]\s*\(status:\s*([a-z]+)(?:,\s*addressed in\s*([a-f0-9]+))?\)\n\n([\s\S]*)$/i.exec(body);
  if (!match) return null;
  return {
    filePath: match[1],
    lineNumber: Number(match[2]),
    side: "RIGHT" as const,
    commitSha: match[3] ?? null,
    status: (match[4].toLowerCase() as "open" | "addressed" | "resolved") || "open",
    addressedCommitSha: match[5] ?? null,
    comment: match[6].trim(),
  };
}

export function formatLineReplyBody(comment: string, commitSha?: string | null): string {
  return commitSha
    ? `[Addressed in commit ${commitSha.slice(0, 7)}]\n\n${comment.trim()}`
    : comment.trim();
}

export function parseLineReplyBody(body: string) {
  const match = /^\[Addressed in commit\s*([a-f0-9]+)\]\n\n([\s\S]*)$/i.exec(body);
  if (match) {
    return {
      commitSha: match[1],
      comment: match[2].trim(),
    };
  }
  return {
    commitSha: null,
    comment: body.trim(),
  };
}

export async function loadLineFeedbackThreads(bugId: string): Promise<LineFeedbackThread[]> {
  const allComments = await prisma.comment.findMany({
    where: { bugId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      bugId: true,
      authorId: true,
      agentId: true,
      parentId: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true, email: true } },
    },
  });

  const threadMap = new Map<string, LineFeedbackThread>();

  // First pass: find thread roots
  for (const c of allComments) {
    if (!c.parentId && isLineFeedbackBody(c.body)) {
      const parsed = parseLineFeedbackBody(c.body);
      if (parsed) {
        threadMap.set(c.id, {
          id: c.id,
          bugId: c.bugId,
          filePath: parsed.filePath,
          lineNumber: parsed.lineNumber,
          side: "RIGHT",
          commitSha: parsed.commitSha,
          status: parsed.status,
          addressedCommitSha: parsed.addressedCommitSha,
          comment: parsed.comment,
          authorId: c.authorId,
          authorName: c.author?.name ?? c.author?.email ?? "User",
          agentId: c.agentId,
          createdAt: c.createdAt.toISOString(),
          replies: [],
        });
      }
    }
  }

  // Second pass: associate replies
  for (const c of allComments) {
    if (c.parentId && threadMap.has(c.parentId)) {
      const thread = threadMap.get(c.parentId)!;
      const parsedReply = parseLineReplyBody(c.body);
      thread.replies.push({
        id: c.id,
        threadId: c.parentId,
        authorId: c.authorId,
        authorName: c.author?.name ?? c.author?.email ?? "User",
        agentId: c.agentId,
        comment: parsedReply.comment,
        commitSha: parsedReply.commitSha,
        createdAt: c.createdAt.toISOString(),
      });
    }
  }

  return Array.from(threadMap.values());
}
