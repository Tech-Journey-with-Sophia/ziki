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
    coverTestMission: vi.fn(),
  };
});

vi.mock("@/lib/agent-api/issues", () => ({
  agentIssueRequest: mocks.agentIssueRequest,
  issueJson: mocks.issueJson,
  issueProject: mocks.issueProject,
}));
vi.mock("@/lib/missions", () => ({
  coverTestMission: mocks.coverTestMission,
  missionCoverageSchema: { extend: () => ({ strict: () => ({ parse: (input: unknown) => input }) }) },
}));

import { POST } from "./route";

const request = { nextUrl: { searchParams: new URLSearchParams() } } as never;
const context = { params: Promise.resolve({ id: "mission-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.issueJson.mockResolvedValue({ projectId: "project-1", issuesFiled: 2 });
  mocks.issueProject.mockResolvedValue({ projectId: "project-1", tenantId: "tenant-1" });
  mocks.coverTestMission.mockResolvedValue(true);
});

describe("POST /api/v1/missions/:id/covered (#619)", () => {
  it("records coverage and the number of issues filed", async () => {
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ covered: true, issuesFiled: 2 });
    expect(mocks.agentIssueRequest).toHaveBeenCalledWith(request, "missions.covered", "working", "mission:mission-1", expect.any(Function));
    expect(mocks.coverTestMission).toHaveBeenCalledWith(mocks.agent, "project-1", "mission-1", 2);
  });

  it("rejects reports from agents without an active assignment", async () => {
    mocks.coverTestMission.mockResolvedValue(false);
    const response = await POST(request, context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "mission_not_assigned" });
  });
});
