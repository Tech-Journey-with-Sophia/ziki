"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  formatLineFeedbackBody,
  formatLineReplyBody,
  parseLineFeedbackBody,
} from "@/lib/pull-request-line-feedback";

export async function addLineFeedbackAction(
  bugId: string,
  params: {
    filePath: string;
    lineNumber: number;
    side?: "LEFT" | "RIGHT";
    commitSha?: string | null;
    comment: string;
  },
) {
  const user = await requireUser();
  if (!params.comment?.trim()) {
    return { error: "Comment cannot be empty." };
  }
  if (!params.filePath?.trim() || !params.lineNumber) {
    return { error: "File and line number are required." };
  }

  const bug = await prisma.bug.findUnique({
    where: { id: bugId },
    select: { id: true, number: true, isDeleted: true },
  });
  if (!bug || bug.isDeleted) {
    return { error: "Issue not found." };
  }

  const formattedBody = formatLineFeedbackBody({
    filePath: params.filePath,
    lineNumber: params.lineNumber,
    side: params.side ?? "RIGHT",
    commitSha: params.commitSha,
    status: "open",
    comment: params.comment,
  });

  const comment = await prisma.comment.create({
    data: {
      bugId,
      authorId: user.id,
      body: formattedBody,
    },
    select: { id: true },
  });

  revalidatePath(`/issues/${bug.number}`);
  return { ok: true, commentId: comment.id };
}

export async function replyLineFeedbackAction(
  bugId: string,
  params: {
    threadId: string;
    comment: string;
    commitSha?: string | null;
    markAddressed?: boolean;
    agentId?: string | null;
  },
) {
  const user = await requireUser();
  if (!params.comment?.trim()) {
    return { error: "Reply cannot be empty." };
  }

  const parent = await prisma.comment.findUnique({
    where: { id: params.threadId },
    select: { id: true, body: true },
  });
  if (!parent) {
    return { error: "Feedback thread not found." };
  }

  const formattedReply = formatLineReplyBody(params.comment, params.commitSha);

  await prisma.comment.create({
    data: {
      bugId,
      parentId: params.threadId,
      authorId: user.id,
      agentId: params.agentId ?? null,
      body: formattedReply,
    },
  });

  // If commitSha or markAddressed is set, update parent status to addressed
  if (params.commitSha || params.markAddressed) {
    const parsed = parseLineFeedbackBody(parent.body);
    if (parsed) {
      const updatedBody = formatLineFeedbackBody({
        filePath: parsed.filePath,
        lineNumber: parsed.lineNumber,
        side: parsed.side,
        commitSha: parsed.commitSha,
        status: "addressed",
        addressedCommitSha: params.commitSha ?? parsed.addressedCommitSha,
        comment: parsed.comment,
      });
      await prisma.comment.update({
        where: { id: params.threadId },
        data: { body: updatedBody },
      });
    }
  }

  const bug = await prisma.bug.findUnique({ where: { id: bugId }, select: { number: true } });
  if (bug) revalidatePath(`/issues/${bug.number}`);
  return { ok: true };
}

export async function resolveLineFeedbackAction(
  bugId: string,
  params: {
    threadId: string;
  },
) {
  await requireUser();

  const parent = await prisma.comment.findUnique({
    where: { id: params.threadId },
    select: { id: true, body: true },
  });
  if (!parent) {
    return { error: "Feedback thread not found." };
  }

  const parsed = parseLineFeedbackBody(parent.body);
  if (parsed) {
    const updatedBody = formatLineFeedbackBody({
      filePath: parsed.filePath,
      lineNumber: parsed.lineNumber,
      side: parsed.side,
      commitSha: parsed.commitSha,
      status: "resolved",
      addressedCommitSha: parsed.addressedCommitSha,
      comment: parsed.comment,
    });
    await prisma.comment.update({
      where: { id: params.threadId },
      data: { body: updatedBody },
    });
  }

  const bug = await prisma.bug.findUnique({ where: { id: bugId }, select: { number: true } });
  if (bug) revalidatePath(`/issues/${bug.number}`);
  return { ok: true };
}
