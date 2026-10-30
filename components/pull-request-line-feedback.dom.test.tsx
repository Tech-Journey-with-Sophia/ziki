// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullRequestLineFeedback } from "./pull-request-line-feedback";
import * as actions from "@/app/actions/pull-request-feedback";

vi.mock("@/app/actions/pull-request-feedback", () => ({
  addLineFeedbackAction: vi.fn(async () => ({ ok: true })),
  replyLineFeedbackAction: vi.fn(async () => ({ ok: true })),
  resolveLineFeedbackAction: vi.fn(async () => ({ ok: true })),
}));

afterEach(() => cleanup());

describe("PullRequestLineFeedback component", () => {
  const threads = [
    {
      id: "thread-1",
      bugId: "bug-1",
      filePath: "lib/auth.ts",
      lineNumber: 42,
      side: "RIGHT" as const,
      commitSha: "abc1234",
      status: "open" as const,
      addressedCommitSha: null,
      comment: "Missing null check here.",
      authorId: "user-1",
      authorName: "Alice Reviewer",
      agentId: null,
      createdAt: "2026-10-30T00:00:00.000Z",
      replies: [],
    },
  ];

  it("renders the line-level feedback section and warns of open comments remaining before approval", () => {
    render(
      <PullRequestLineFeedback
        bugId="bug-1"
        pullRequestUrl="https://github.com/emerjent/ziki/pull/288"
        pullRequestHeadSha="abc1234"
        threads={threads}
        canComment={true}
      />,
    );

    expect(screen.getByTestId("pr-line-feedback-section")).toBeTruthy();
    expect(screen.getByTestId("open-line-feedback-alert").textContent).toContain(
      "1 open line comment remaining before approving the fix.",
    );
    expect(screen.getByText("lib/auth.ts:42")).toBeTruthy();
    expect(screen.getByText("Missing null check here.")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("allows opening the form to add a line feedback comment", async () => {
    const user = userEvent.setup();
    render(
      <PullRequestLineFeedback
        bugId="bug-1"
        pullRequestUrl="https://github.com/emerjent/ziki/pull/288"
        pullRequestHeadSha="abc1234"
        threads={[]}
        canComment={true}
      />,
    );

    const addBtn = screen.getByRole("button", { name: "+ Add line feedback" });
    await user.click(addBtn);

    const fileInput = screen.getByPlaceholderText(/File path/i);
    const lineInput = screen.getByPlaceholderText(/Line #/i);
    const commentInput = screen.getByPlaceholderText(/What should the agent change/i);

    await user.type(fileInput, "lib/worker.ts");
    await user.type(lineInput, "15");
    await user.type(commentInput, "Wrap this call in try/catch.");

    const submitBtn = screen.getByRole("button", { name: "Post line feedback" });
    await user.click(submitBtn);

    expect(actions.addLineFeedbackAction).toHaveBeenCalledWith("bug-1", {
      filePath: "lib/worker.ts",
      lineNumber: 15,
      commitSha: "abc1234",
      comment: "Wrap this call in try/catch.",
    });
  });

  it("allows a human to resolve a thread", async () => {
    const user = userEvent.setup();
    render(
      <PullRequestLineFeedback
        bugId="bug-1"
        pullRequestUrl="https://github.com/emerjent/ziki/pull/288"
        pullRequestHeadSha="abc1234"
        threads={threads}
        canComment={true}
      />,
    );

    const resolveBtn = screen.getByRole("button", { name: "Resolve" });
    await user.click(resolveBtn);

    expect(actions.resolveLineFeedbackAction).toHaveBeenCalledWith("bug-1", {
      threadId: "thread-1",
    });
  });
});
