import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  agentIssueRequest: vi.fn(async (_req, _action, _level, _target, handler) => {
    return handler({
      agentId: "agent-1",
      name: "Agent One",
      tenantId: "tenant-1",
      ownerId: "user-1",
      level: "working",
      burst: false,
      keyId: "key-1",
    });
  }),
  issueJson: vi.fn(),
  prisma: {
    bug: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    bugRevision: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(mocks.prisma)),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/agent-api/issues", () => ({
  agentIssueRequest: mocks.agentIssueRequest,
  issueJson: mocks.issueJson,
  IssueApiError: class extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/agents/audit", () => ({ audit: mocks.audit }));

describe("POST /api/v1/ideas/[id]/structure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("structures an unstructured draft idea and records revision", async () => {
    mocks.prisma.bug.findUnique.mockResolvedValueOnce({
      id: "bug-1",
      number: 101,
      title: "Quick idea",
      description: "Allow users to download their activity data as CSV.",
      status: "open",
      tenantId: "tenant-1",
      projectId: "proj-1",
      createdByAgentId: null,
    });

    mocks.issueJson.mockResolvedValueOnce({
      summary: "CSV export for user activity data",
      problem: "Users cannot export their activity data.",
      proposedSolution: "Add a CSV export button on activity dashboard.",
      acceptanceCriteria: ["CSV export button works", "Data is downloaded properly"],
    });

    mocks.prisma.bug.update.mockResolvedValueOnce({
      id: "bug-1",
      number: 101,
      title: "Quick idea",
      description: "## Summary\n...",
      status: "open",
    });

    const request = new NextRequest("http://localhost/api/v1/ideas/bug-1/structure", {
      method: "POST",
    });

    const response = await POST(request, { params: Promise.resolve({ id: "bug-1" }) });
    expect(response.status).toBe(200);

    expect(mocks.prisma.bugRevision.create).toHaveBeenCalledWith({
      data: {
        bugId: "bug-1",
        title: "Quick idea",
        description: "Allow users to download their activity data as CSV.",
        editedById: "user-1",
      },
    });

    expect(mocks.prisma.bug.update).toHaveBeenCalled();
    const updateCall = mocks.prisma.bug.update.mock.calls[0][0];
    expect(updateCall.data.description).toContain("## Summary\nCSV export for user activity data");
    expect(updateCall.data.description).toContain("## Acceptance Criteria\n- [ ] CSV export button works");
  });
});
