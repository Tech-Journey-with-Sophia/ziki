import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const agent = {
    agentId: "agent-1", ownerId: "owner-1", tenantId: "tenant-1", level: "working",
    burst: false, keyId: "key-1", name: "Tester",
  };
  return {
    agent,
    agentIssueRequest: vi.fn(async (_request, _action, _level, _target, run) => run(agent)),
    issueJson: vi.fn(),
    issueProject: vi.fn(),
    nextTestMission: vi.fn(),
  };
});

vi.mock("@/lib/agent-api/issues", () => ({
  agentIssueRequest: mocks.agentIssueRequest,
  issueJson: mocks.issueJson,
  issueProject: mocks.issueProject,
}));
vi.mock("@/lib/missions", () => ({
  nextMissionSchema: { parse: (input: unknown) => input },
  nextTestMission: mocks.nextTestMission,
}));

import { POST } from "./route";

const request = { nextUrl: { searchParams: new URLSearchParams() } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.issueJson.mockResolvedValue({ projectId: "project-1" });
  mocks.issueProject.mockResolvedValue({ projectId: "project-1", tenantId: "tenant-1" });
  mocks.nextTestMission.mockResolvedValue({
    id: "mission-1", projectId: "project-1", project: { name: "Web", stagingUrl: "https://staging.example" },
    routePattern: "/settings/**", brief: "Check settings", role: "member", viewport: "mobile_375",
    leaseExpiresAt: new Date("2026-10-21T12:00:00Z"),
  });
});

describe("POST /api/v1/missions/next (#619)", () => {
  it("returns a leased route mission with its role and viewport", async () => {
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "mission-1",
      projectId: "project-1",
      routePattern: "/settings/**",
      role: "member",
      viewport: "mobile_375",
      stagingUrl: "https://staging.example",
    });
    expect(mocks.agentIssueRequest).toHaveBeenCalledWith(request, "missions.next", "working", null, expect.any(Function));
    expect(mocks.nextTestMission).toHaveBeenCalledWith(mocks.agent, "project-1");
  });

  it("returns a conflict when there are no missions available", async () => {
    mocks.nextTestMission.mockResolvedValue(null);
    const response = await POST(request);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "no_missions_available" });
  });
});
