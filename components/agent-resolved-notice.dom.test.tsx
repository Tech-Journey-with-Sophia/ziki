// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reopen: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/actions/issues", () => ({ reopenAgentResolvedAction: mocks.reopen }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { AgentResolvedNotice } from "./agent-resolved-notice";

const resolution = { agentName: "Charles Xavier", pullRequestUrl: "https://github.com/acme/app/pull/12", previousStatus: "open" as const };

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("AgentResolvedNotice (Ziki #515)", () => {
  it("names the agent and links the merged pull request", () => {
    render(<AgentResolvedNotice bugId="bug1" resolution={resolution} canReopen={false} />);
    expect(screen.getByText("Charles Xavier")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "its pull request" })).toHaveAttribute("href", resolution.pullRequestUrl);
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });

  it("reopens in one click and refreshes the page", async () => {
    const user = userEvent.setup({ delay: null });
    mocks.reopen.mockResolvedValue({ ok: true });
    render(<AgentResolvedNotice bugId="bug1" resolution={resolution} canReopen />);
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(mocks.reopen).toHaveBeenCalledWith("bug1");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("shows why a reopen failed", async () => {
    const user = userEvent.setup({ delay: null });
    mocks.reopen.mockResolvedValue({ error: "Only the assignee can do that." });
    render(<AgentResolvedNotice bugId="bug1" resolution={resolution} canReopen />);
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the assignee can do that.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
