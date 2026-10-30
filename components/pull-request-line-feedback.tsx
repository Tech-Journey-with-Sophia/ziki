"use client";

import { useState, useTransition } from "react";
import type { LineFeedbackThread } from "@/lib/pull-request-line-feedback";
import {
  addLineFeedbackAction,
  replyLineFeedbackAction,
  resolveLineFeedbackAction,
} from "@/app/actions/pull-request-feedback";

interface PullRequestLineFeedbackProps {
  bugId: string;
  pullRequestUrl: string;
  pullRequestHeadSha?: string | null;
  threads: LineFeedbackThread[];
  canComment: boolean;
}

export function PullRequestLineFeedback({
  bugId,
  pullRequestUrl,
  pullRequestHeadSha,
  threads,
  canComment,
}: PullRequestLineFeedbackProps) {
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedFile, setSelectedFile] = useState("");
  const [selectedLine, setSelectedLine] = useState<number | "">("");
  const [commentText, setCommentText] = useState("");
  const [replyTextMap, setReplyTextMap] = useState<Record<string, string>>({});
  const [replyCommitMap, setReplyCommitMap] = useState<Record<string, string>>({});
  const [openReplyThreadId, setOpenReplyThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCount = threads.filter((t) => t.status === "open").length;

  const handleAddThread = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile.trim() || !selectedLine || !commentText.trim()) {
      setError("Please specify file, line number, and your feedback.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addLineFeedbackAction(bugId, {
        filePath: selectedFile.trim(),
        lineNumber: Number(selectedLine),
        commitSha: pullRequestHeadSha ?? null,
        comment: commentText.trim(),
      });
      if (res.error) {
        setError(res.error);
      } else {
        setCommentText("");
        setShowAddForm(false);
      }
    });
  };

  const handleReply = (threadId: string) => {
    const text = replyTextMap[threadId]?.trim();
    if (!text) return;
    const commit = replyCommitMap[threadId]?.trim();
    startTransition(async () => {
      const res = await replyLineFeedbackAction(bugId, {
        threadId,
        comment: text,
        commitSha: commit || undefined,
        markAddressed: Boolean(commit),
      });
      if (res.error) {
        setError(res.error);
      } else {
        setReplyTextMap((prev) => ({ ...prev, [threadId]: "" }));
        setReplyCommitMap((prev) => ({ ...prev, [threadId]: "" }));
        setOpenReplyThreadId(null);
      }
    });
  };

  const handleResolve = (threadId: string) => {
    startTransition(async () => {
      await resolveLineFeedbackAction(bugId, { threadId });
    });
  };

  return (
    <section
      data-testid="pr-line-feedback-section"
      className="rounded-[20px] border border-zk-border bg-zk-surface p-5 shadow-[0_4px_24px_rgba(0,0,0,0.02)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zk-divider pb-4">
        <div>
          <h3 className="text-base font-bold text-zk-text">
            Line-level PR Feedback
          </h3>
          <p className="mt-0.5 text-xs text-zk-muted">
            Leave comments anchored to exact files and lines of{" "}
            <a
              href={pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-zk-accent hover:underline"
            >
              the linked pull request
            </a>
            {pullRequestHeadSha ? ` @ ${pullRequestHeadSha.slice(0, 7)}` : ""}.
          </p>
        </div>

        {canComment ? (
          <button
            type="button"
            onClick={() => setShowAddForm((val) => !val)}
            className="inline-flex h-8 items-center justify-center rounded-full bg-electric-blue-strong px-3.5 text-xs font-bold text-white shadow-xs transition hover:brightness-105"
          >
            {showAddForm ? "Cancel" : "+ Add line feedback"}
          </button>
        ) : null}
      </div>

      {/* Review Gate Status Banner */}
      {openCount > 0 ? (
        <div
          data-testid="open-line-feedback-alert"
          className="mt-4 flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-bold text-amber-900"
        >
          <span className="text-base">⚠️</span>
          <span>
            {openCount} open line comment{openCount === 1 ? "" : "s"} remaining before approving the fix.
          </span>
        </div>
      ) : threads.length > 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800">
          <span>✓</span>
          <span>
            All line comments have been addressed or resolved. Ready for review approval!
          </span>
        </div>
      ) : null}

      {/* Add Line Feedback Form */}
      {showAddForm ? (
        <form onSubmit={handleAddThread} className="mt-4 space-y-3 rounded-xl border border-zk-border bg-zk-chip/40 p-3.5">
          <p className="text-xs font-bold text-zk-text">Anchor feedback to a line</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="feedback-filepath" className="sr-only">File path</label>
              <input
                id="feedback-filepath"
                type="text"
                placeholder="File path (e.g. lib/auth.ts)"
                value={selectedFile}
                onChange={(e) => setSelectedFile(e.target.value)}
                className="w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-1.5 text-xs font-mono text-zk-text focus:outline-electric-blue"
                required
              />
            </div>
            <div>
              <label htmlFor="feedback-line" className="sr-only">Line number</label>
              <input
                id="feedback-line"
                type="number"
                min="1"
                placeholder="Line #"
                value={selectedLine}
                onChange={(e) => setSelectedLine(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-1.5 text-xs text-zk-text focus:outline-electric-blue"
                required
              />
            </div>
          </div>
          <div>
            <textarea
              rows={3}
              placeholder="What should the agent change on this line? Be specific so the agent can fix it immediately."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="w-full rounded-lg border border-zk-border bg-zk-surface p-2.5 text-xs text-zk-text focus:outline-electric-blue"
              required
            />
          </div>
          {error ? <p className="text-xs text-zk-bad-fg">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-lg px-3 py-1 text-xs font-semibold text-zk-muted hover:text-zk-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-electric-blue px-3.5 py-1 text-xs font-bold text-white hover:brightness-105 disabled:opacity-50"
            >
              {isPending ? "Posting..." : "Post line feedback"}
            </button>
          </div>
        </form>
      ) : null}

      {/* Threads List */}
      <div className="mt-4 space-y-3">
        {threads.length === 0 ? (
          <p className="text-xs text-zk-muted">
            No line-level feedback yet. Humans can anchor comments to specific lines for the assigned agent to address.
          </p>
        ) : (
          threads.map((thread) => (
            <div
              key={thread.id}
              data-testid="line-feedback-thread"
              data-status={thread.status}
              className="rounded-xl border border-zk-divider bg-zk-surface p-3 text-xs space-y-2"
            >
              {/* Header: file, line, status badge */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold text-zk-text">
                    {thread.filePath}:{thread.lineNumber}
                  </span>
                  {thread.commitSha ? (
                    <span className="font-mono text-zk-muted text-[11px]">
                      @{thread.commitSha.slice(0, 7)}
                    </span>
                  ) : null}
                  <span className="text-zk-muted">by {thread.authorName}</span>
                </div>

                <div className="flex items-center gap-2">
                  {thread.status === "open" ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                      Open
                    </span>
                  ) : thread.status === "addressed" ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                      Addressed{thread.addressedCommitSha ? ` in ${thread.addressedCommitSha.slice(0, 7)}` : ""}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                      Resolved
                    </span>
                  )}

                  {thread.status !== "resolved" && canComment ? (
                    <button
                      type="button"
                      onClick={() => handleResolve(thread.id)}
                      disabled={isPending}
                      className="rounded-md border border-zk-border px-2 py-0.5 text-[11px] font-bold text-zk-text hover:bg-zk-chip"
                    >
                      Resolve
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Thread comment */}
              <p className="whitespace-pre-line text-zk-text2 leading-relaxed">
                {thread.comment}
              </p>

              {/* Replies */}
              {thread.replies.length > 0 ? (
                <div className="mt-2 space-y-2 border-t border-zk-divider pt-2 pl-3">
                  {thread.replies.map((reply) => (
                    <div key={reply.id} className="text-[11px] text-zk-text2">
                      <div className="flex items-center gap-1.5 font-semibold text-zk-text">
                        <span>{reply.authorName}</span>
                        {reply.agentId ? (
                          <span className="rounded-full bg-zk-info-bg px-1.5 py-0.2 text-[10px] text-zk-info-fg">
                            Agent
                          </span>
                        ) : null}
                        {reply.commitSha ? (
                          <span className="font-mono text-zk-muted">
                            (Commit: {reply.commitSha.slice(0, 7)})
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 whitespace-pre-line">{reply.comment}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Inline Reply Form */}
              {openReplyThreadId === thread.id ? (
                <div className="mt-2 border-t border-zk-divider pt-2 space-y-2">
                  <textarea
                    rows={2}
                    placeholder="Write a reply..."
                    value={replyTextMap[thread.id] ?? ""}
                    onChange={(e) =>
                      setReplyTextMap((prev) => ({ ...prev, [thread.id]: e.target.value }))
                    }
                    className="w-full rounded-md border border-zk-border bg-zk-chip/30 p-2 text-xs text-zk-text focus:outline-electric-blue"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <input
                      type="text"
                      placeholder="Commit reference (e.g. a1b2c3d)"
                      value={replyCommitMap[thread.id] ?? ""}
                      onChange={(e) =>
                        setReplyCommitMap((prev) => ({ ...prev, [thread.id]: e.target.value }))
                      }
                      className="rounded-md border border-zk-border bg-zk-chip/30 px-2 py-1 font-mono text-[11px] text-zk-text"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenReplyThreadId(null)}
                        className="px-2 py-1 text-xs text-zk-muted hover:text-zk-text"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReply(thread.id)}
                        disabled={isPending || !replyTextMap[thread.id]?.trim()}
                        className="rounded-md bg-electric-blue px-3 py-1 text-xs font-bold text-white hover:brightness-105 disabled:opacity-50"
                      >
                        Send reply
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setOpenReplyThreadId(thread.id)}
                    className="text-xs font-bold text-zk-accent hover:underline"
                  >
                    Reply
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
