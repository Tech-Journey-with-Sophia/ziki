import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const leaderboard = vi.hoisted(() => vi.fn());
const fetchDashboard = vi.hoisted(() => vi.fn());
const findManyAgents = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-user", role: "admin" })),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantIdFor: vi.fn(async () => "tenant-acme"),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agent: {
      findMany: findManyAgents,
    },
  },
}));
vi.mock("@/lib/points/leaderboard", () => ({
  paginatedTenantLeaderboard: leaderboard,
}));
vi.mock("@/lib/dashboard-queries", () => ({
  fetchDashboard,
}));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchDashboard.mockResolvedValue({
      byStatus: [
        { status: "open", count: 4 },
        { status: "in_progress", count: 2 },
        { status: "resolved", count: 3 },
      ],
      weekly: [],
      medianFirstResponseSeconds: null,
      medianResolutionSeconds: null,
      byPlatform: [{ label: "Web", count: 5 }],
      byType: [{ label: "bug", count: 5 }],
      bySeverity: [{ label: "high", count: 3 }],
      totalOpened: 9,
      totalClosed: 3,
    });
    findManyAgents.mockResolvedValue([]);
    leaderboard.mockResolvedValue({ entries: [], total: 0, page: 1, limit: 5, totalPages: 1 });
  });

  it("renders high-signal stats and eliminates clutter", async () => {
    const html = renderToStaticMarkup(
      (await DashboardPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );

    // High-signal stats
    expect(html).toContain("Opened");
    expect(html).toContain("Closed");
    expect(html).toContain("In Progress");
    expect(html).toContain("Open Backlog");

    // Clutter metrics removed
    expect(html).not.toContain("Median time to first reply");
    expect(html).not.toContain("Median time to resolution");
    expect(html).not.toContain("Opened vs closed, by week");
  });

  it("renders empty state for contributor leaderboard gracefully", async () => {
    leaderboard.mockResolvedValue({ entries: [], total: 0, page: 1, limit: 5, totalPages: 1 });
    const html = renderToStaticMarkup(
      (await DashboardPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );

    expect(html).toContain("Top Contributors");
    expect(html).toContain("No contributions yet in this workspace.");
    expect(html).toContain('href="/leaderboard"');
  });

  it("renders ranked contributors with agent and human badges", async () => {
    leaderboard.mockResolvedValue({
      entries: [
        { userId: "u1", name: "Alice Agent", image: null, rank: 1, points: 50, solvedTasks: 5 },
        { userId: "u2", name: "Bob Human", image: null, rank: 2, points: 30, solvedTasks: 2 },
      ],
      total: 2,
      page: 1,
      limit: 5,
      totalPages: 1,
    });
    findManyAgents.mockResolvedValue([{ ownerUserId: "u1" }]);

    const html = renderToStaticMarkup(
      (await DashboardPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );

    expect(html).toContain("Alice Agent");
    expect(html).toContain("Bob Human");
    expect(html).toContain("Agent");
    expect(html).toContain("Contributor");
    expect(html).toContain("50 pts");
    expect(html).toContain("30 pts");
    expect(html).toContain("5 solved");
    expect(html).toContain("2 solved");
    expect(html).toContain('href="/users/u1"');
    expect(html).toContain('href="/users/u2"');
  });

  it("renders breakdown cards for status, severity, and platform", async () => {
    const html = renderToStaticMarkup(
      (await DashboardPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );

    expect(html).toContain("By status");
    expect(html).toContain("By severity");
    expect(html).toContain("By platform");
  });
});
