import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject } from "@/lib/agent-api/issues";
import { parseIssueRef } from "@/lib/issue-ref";
import { prisma } from "@/lib/prisma";
import {
  formatLineFeedbackBody,
  formatLineReplyBody,
  loadLineFeedbackThreads,
  parseLineFeedbackBody,
} from "@/lib/pull-request-line-feedback";

/**
 * GET ?projectId= returns the line feedback threads on the issue's pull request.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "line-feedback.list", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    const ref = parseIssueRef(id);
    const bug = await prisma.bug.findFirst({
      where: { ...scope, ...(ref.kind === "number" ? { number: ref.number } : { id: ref.id }), isDeleted: false },
      select: { id: true },
    });
    if (!bug) {
      return NextResponse.json({ error: "Issue not found." }, { status: 404 });
    }
    const threads = await loadLineFeedbackThreads(bug.id);
    return NextResponse.json({ lineFeedback: threads });
  });
}

/**
 * POST { threadId, comment, commitSha?, markAddressed? }
 * Lets an agent reply to a line-level feedback thread and mark it addressed with a commit reference.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "line-feedback.reply", "working", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    const ref = parseIssueRef(id);
    const bug = await prisma.bug.findFirst({
      where: { ...scope, ...(ref.kind === "number" ? { number: ref.number } : { id: ref.id }), isDeleted: false },
      select: { id: true },
    });
    if (!bug) {
      return NextResponse.json({ error: "Issue not found." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const { threadId, comment, commitSha, markAddressed = true } = body;
    if (!threadId || !comment || typeof comment !== "string" || !comment.trim()) {
      return NextResponse.json({ error: "threadId and non-empty comment are required." }, { status: 400 });
    }

    const parent = await prisma.comment.findFirst({
      where: { id: threadId, bugId: bug.id, deletedAt: null },
      select: { id: true, body: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "Feedback thread not found." }, { status: 404 });
    }

    const formattedReply = formatLineReplyBody(comment, commitSha ?? null);

    const created = await prisma.comment.create({
      data: {
        bugId: bug.id,
        parentId: threadId,
        authorId: agent.ownerId,
        agentId: agent.agentId,
        body: formattedReply,
      },
      select: { id: true, createdAt: true },
    });

    if (commitSha || markAddressed) {
      const parsed = parseLineFeedbackBody(parent.body);
      if (parsed) {
        const updatedBody = formatLineFeedbackBody({
          filePath: parsed.filePath,
          lineNumber: parsed.lineNumber,
          side: parsed.side,
          commitSha: parsed.commitSha,
          status: "addressed",
          addressedCommitSha: commitSha ?? parsed.addressedCommitSha,
          comment: parsed.comment,
        });
        await prisma.comment.update({
          where: { id: threadId },
          data: { body: updatedBody },
        });
      }
    }

    return NextResponse.json({ ok: true, replyId: created.id, status: markAddressed ? "addressed" : "open" }, { status: 201 });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
