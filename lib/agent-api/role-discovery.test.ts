import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  bug: { findMany: vi.fn() },
  issueValidation: { findMany: vi.fn() },
  workflow: { findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/workflow", () => ({
  workflowFor: vi.fn(async () => ({
    confirmationsNeeded: 2,
    verdictsNeeded: 2,
    offerWindowSeconds: 1800,
  })),
}));
vi.mock("@/lib/agent-api/validation", () => ({
  isConfirmed: vi.fn(async () => true),
}));

import { findReadyToMergeIssues } from "./merger";
import { findReviewableIssues } from "./reviewer";
import { findTriageableIssues } from "./triager";
import { findClaimableIssues } from "./contributor";
import { AgentLevelError } from "@/lib/agents/levels";

const contributor = { agentId: "c1", name: "c1", ownerId: "co", tenantId: "tenant", level: "working" as const, burst: false, keyId: "k" };
const triager = { agentId: "t1", name: "t1", ownerId: "to", tenantId: "tenant", level: "working" as const, burst: false, keyId: "k" };
const reviewer = { agentId: "r1", name: "r1", ownerId: "ro", tenantId: "tenant", level: "working" as const, burst: false, keyId: "k" };
const merger = { agentId: "m1", name: "m1", ownerId: "mo", tenantId: "tenant", level: "manager" as const, burst: false, keyId: "k" };

describe("Role-based discovery functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findReadyToMergeIssues", () => {
    it("needs a manager agent", async () => {
      await expect(findReadyToMergeIssues(contributor, "p1")).rejects.toBeInstanceOf(AgentLevelError);
    });

    it("returns ready to merge issues when conditions are met", async () => {
      db.bug.findMany.mockResolvedValue([
        {
          id: "bug-1",
          number: 101,
          title: "PR ready to merge",
          projectId: "p1",
          pullRequestUrl: "https://github.com/org/repo/pull/1",
          pullRequestHeadSha: "sha-1",
          reporterId: "user-1",
          beneficiaryUserId: "user-1",
          createdByAgentId: null,
          createdAt: new Date(),
          claims: [{ agentId: "solver-1", beneficiaryUserId: "user-2", agent: { ownerUserId: "user-2" } }],
          testVerdicts: [
            { id: "v1", onBehalfOfUserId: "rev-1", pullRequestUrl: "https://github.com/org/repo/pull/1", agent: { id: "a1", ownerUserId: "rev-1" } },
            { id: "v2", onBehalfOfUserId: "rev-2", pullRequestUrl: "https://github.com/org/repo/pull/1", agent: { id: "a2", ownerUserId: "rev-2" } },
          ],
        },
      ]);

      const issues = await findReadyToMergeIssues(merger, "p1");
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        id: "bug-1",
        number: 101,
        verdictsCount: 2,
      });
    });

    it("filters by reviewStatus parameter when provided", async () => {
      db.bug.findMany.mockResolvedValue([
        {
          id: "bug-accepted",
          number: 102,
          title: "Accepted PR",
          projectId: "p1",
          pullRequestUrl: "https://github.com/org/repo/pull/2",
          pullRequestHeadSha: "sha-2",
          reviewStatus: "ready_to_merge",
          reporterId: "user-1",
          beneficiaryUserId: "user-1",
          createdByAgentId: null,
          createdAt: new Date(),
          claims: [],
          testVerdicts: [],
        },
      ]);

      const issues = await findReadyToMergeIssues(merger, "p1", 50, "ready_to_merge");
      expect(db.bug.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            // A blocked or failed merge is still waiting on the merger agent.
            AND: [{ reviewStatus: { in: ["ready_to_merge", "merge_blocked", "merge_failed"] } }],
          }),
        }),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].reviewStatus).toBe("ready_to_merge");
    });

    it("matches submitted or not-yet-reviewed fixes without putting null inside `in`, which Prisma rejects", async () => {
      db.bug.findMany.mockResolvedValue([]);
      await findReadyToMergeIssues(merger, "p1", 50, "submitted");
      const where = db.bug.findMany.mock.calls.at(-1)![0].where;
      expect(where.AND).toEqual([{ OR: [{ reviewStatus: "submitted" }, { reviewStatus: null }] }]);
      expect(JSON.stringify(where)).not.toMatch(/"in":\[[^\]]*null/);
    });

    it("keeps a blocked merge on the list so it can be tried again", async () => {
      db.bug.findMany.mockResolvedValue([
        {
          id: "bug-blocked",
          number: 103,
          title: "Blocked merge",
          projectId: "p1",
          pullRequestUrl: "https://github.com/org/repo/pull/3",
          pullRequestHeadSha: "sha-3",
          reviewStatus: "merge_blocked",
          reporterId: "user-1",
          beneficiaryUserId: "user-1",
          createdByAgentId: null,
          createdAt: new Date(),
          claims: [],
          testVerdicts: [],
        },
      ]);

      const issues = await findReadyToMergeIssues(merger, "p1", 50, "ready_to_merge");
      expect(issues).toHaveLength(1);
      expect(issues[0].reviewStatus).toBe("merge_blocked");
    });
  });

  describe("findReviewableIssues", () => {
    it("is open to every working agent", async () => {
      db.bug.findMany.mockResolvedValue([]);
      await expect(findReviewableIssues(contributor, "p1")).resolves.toEqual([]);
    });

    it("finds reviewable issues for validation and testing", async () => {
      db.bug.findMany.mockResolvedValue([
        {
          id: "bug-2",
          number: 102,
          title: "Needs testing",
          projectId: "p1",
          pullRequestUrl: "https://github.com/org/repo/pull/2",
          reporterId: "user-1",
          beneficiaryUserId: "user-1",
          createdByAgentId: null,
          createdAt: new Date(),
          claims: [],
        },
      ]);

      const issues = await findReviewableIssues(reviewer, "p1", "test");
      expect(issues).toHaveLength(1);
      expect(issues[0].reviewType).toBe("test");
    });
  });

  describe("findTriageableIssues", () => {
    it("is open to every working agent", async () => {
      db.bug.findMany.mockResolvedValue([]);
      await expect(findTriageableIssues(contributor, "p1")).resolves.toEqual([]);
    });

    it("finds open issues needing triage", async () => {
      // Mock isConfirmed to false so it is treated as unconfirmed/triageable
      const { isConfirmed } = await import("@/lib/agent-api/validation");
      (isConfirmed as unknown as { mockResolvedValueOnce: (val: boolean) => void }).mockResolvedValueOnce(false);

      db.bug.findMany.mockResolvedValue([
        {
          id: "bug-3",
          number: 103,
          title: "New issue",
          projectId: "p1",
          reporterId: "user-1",
          beneficiaryUserId: "user-1",
          createdByAgentId: null,
          createdAt: new Date(),
          claims: [],
        },
      ]);

      const issues = await findTriageableIssues(triager, "p1");
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("bug-3");
    });
  });

  describe("findClaimableIssues", () => {
    it("is open to every working agent", async () => {
      db.bug.findMany.mockResolvedValue([]);
      await expect(findClaimableIssues(contributor, "p1")).resolves.toEqual([]);
    });

    it("finds confirmed issues available for bidding or claiming", async () => {
      db.bug.findMany.mockResolvedValue([
        {
          id: "bug-4",
          number: 104,
          title: "Ready to work",
          projectId: "p1",
          voteCount: 4,
          severity: "high",
          createdAt: new Date(),
        },
      ]);

      const issues = await findClaimableIssues(contributor, "p1");
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("bug-4");
    });
  });
});
