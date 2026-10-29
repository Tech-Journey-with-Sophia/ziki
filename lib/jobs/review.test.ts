import { beforeEach, describe, expect, it, vi } from "vitest";

const audit = vi.hoisted(() => vi.fn());
const publish = vi.hoisted(() => vi.fn());
const award = vi.hoisted(() => vi.fn());

const db = vi.hoisted(() => ({
  jobSubmission: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  jobReview: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  jobReviewOffer: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn(), create: vi.fn() },
  membership: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agents/audit", () => ({ audit }));
vi.mock("@/lib/agent-api/events", () => ({ publish }));
vi.mock("@/lib/points/award", () => ({ award }));

import {
  acceptJobReviewOffer,
  createJobReviewOffers,
  ensureJobReviewOffers,
  expireJobReviewOffer,
  reviewJobSubmission,
  sweepJobReviewOffers,
} from "./review";

const agent = {
  agentId: "reviewer1",
  name: "Bob's Claude",
  ownerId: "owner-bob",
  tenantId: "tenant1",
  level: "working" as const,
  burst: false,
  keyId: "k1",
  projectId: null,
};

const submission = {
  id: "sub1",
  jobId: "job1",
  agentId: "submitter",
  beneficiaryUserId: "owner-ada",
  status: "pending",
  reviewsNeeded: 2,
  job: { id: "job1", tenantId: "tenant1", projectId: "project1", pointsPerAccepted: 10 },
};

const acceptedOffer = { id: "offer1", deadlineAt: new Date(Date.now() + 60_000) };

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  db.jobSubmission.findUnique.mockResolvedValue(submission);
  db.jobReview.findFirst.mockResolvedValue(null);
  db.jobReviewOffer.findFirst.mockResolvedValue(acceptedOffer);
  db.jobReview.create.mockResolvedValue({ id: "review1", verdict: "accept" });
  db.jobReview.findMany.mockResolvedValue([{ beneficiaryUserId: "owner-bob" }]);
  db.jobReviewOffer.update.mockResolvedValue({});
  db.jobReviewOffer.updateMany.mockResolvedValue({ count: 1 });
  db.jobReviewOffer.findMany.mockResolvedValue([]);
  db.jobSubmission.findMany.mockResolvedValue([]);
  db.$queryRaw.mockResolvedValue([{ id: "sub1" }]);
  db.membership.findMany.mockResolvedValue([]);
  db.jobReviewOffer.groupBy.mockResolvedValue([]);
  db.jobSubmission.update.mockImplementation(async ({ data }: { data: object }) => ({ ...submission, ...data }));
  award.mockResolvedValue(false);
});

describe("job review offer recovery (#616)", () => {
  const pendingSubmission = {
    ...submission,
    job: { id: "job1", tenantId: "tenant1", projectId: "project1", pointsPerAccepted: 10 },
  };

  it("preserves the review quorum when no one can review yet", async () => {
    const job = { id: "job1", tenantId: "tenant1", projectId: "project1", pointsPerAccepted: 10 };
    const result = await createJobReviewOffers(
      db as never,
      { agentId: "submitter", tenantId: "tenant1" },
      job,
      submission,
    );

    expect(result).toBe(2);
    expect(db.jobReviewOffer.create).not.toHaveBeenCalled();
  });

  it("creates offers when reviewers become eligible after submission", async () => {
    db.jobSubmission.findUnique.mockResolvedValue(pendingSubmission);
    db.membership.findMany.mockResolvedValue([
      { userId: "owner-carol", user: { agents: [{ id: "reviewer-carol" }] } },
    ]);
    db.jobReviewOffer.create.mockResolvedValue({ id: "offer-carol", offeredAt: new Date() });

    const offered = await ensureJobReviewOffers("sub1");

    expect(offered).toBe(1);
    expect(db.jobReviewOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: "sub1",
        agentId: "reviewer-carol",
        beneficiaryUserId: "owner-carol",
        status: "offered",
      }),
    });
    expect(publish).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ type: "job.review.requested", tenantId: "tenant1" }),
    );
  });

  it("expires due offers durably and re-offers to an eligible reviewer", async () => {
    db.jobReviewOffer.findMany
      .mockResolvedValueOnce([{ id: "offer-bob" }])
      .mockResolvedValueOnce([{ beneficiaryUserId: "owner-bob", status: "expired" }])
      .mockResolvedValueOnce([
        { beneficiaryUserId: "owner-bob", status: "expired" },
        { beneficiaryUserId: "owner-carol", status: "offered" },
      ]);
    db.jobReviewOffer.findUnique.mockResolvedValue({
      id: "offer-bob",
      submissionId: "sub1",
      status: "offered",
      offeredAt: new Date(Date.now() - 31 * 60_000),
      deadlineAt: null,
    });
    db.jobSubmission.findMany.mockResolvedValue([{ id: "sub1" }]);
    db.jobSubmission.findUnique.mockResolvedValue(pendingSubmission);
    db.jobReview.findMany.mockResolvedValue([]);
    db.membership.findMany.mockResolvedValue([
      { userId: "owner-carol", user: { agents: [{ id: "reviewer-carol" }] } },
    ]);
    db.jobReviewOffer.create.mockResolvedValue({ id: "offer-carol", offeredAt: new Date() });

    const result = await sweepJobReviewOffers();

    expect(result).toEqual({ expired: 1, offered: 1 });
    expect(db.jobReviewOffer.updateMany).toHaveBeenCalledWith({
      where: { id: "offer-bob", status: "offered" },
      data: expect.objectContaining({ status: "expired", expiredAt: expect.any(Date) }),
    });
    expect(db.jobReviewOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ beneficiaryUserId: "owner-carol", status: "offered" }),
    });
  });

  it("expires an accepted review after its deadline", async () => {
    db.jobReviewOffer.findUnique.mockResolvedValue({
      id: "offer-bob",
      submissionId: "sub1",
      status: "accepted",
      offeredAt: new Date(Date.now() - 31 * 60_000),
      deadlineAt: new Date(Date.now() - 1),
    });
    db.jobSubmission.findUnique.mockResolvedValue(pendingSubmission);
    db.jobReviewOffer.findMany.mockResolvedValue([
      { beneficiaryUserId: "owner-bob", status: "expired" },
    ]);
    db.jobReview.findMany.mockResolvedValue([]);

    await expect(expireJobReviewOffer("offer-bob")).resolves.toBe("sub1");
    expect(db.jobReviewOffer.updateMany).toHaveBeenCalledWith({
      where: { id: "offer-bob", status: "accepted" },
      data: expect.objectContaining({ status: "expired", expiredAt: expect.any(Date) }),
    });
  });

  it("commits an expired accept before returning 410 and triggers recovery", async () => {
    db.jobReviewOffer.findUnique.mockResolvedValue({
      id: "offer-bob",
      submissionId: "sub1",
      agentId: "reviewer1",
      status: "offered",
      offeredAt: new Date(Date.now() - 31 * 60_000),
      submission: { id: "sub1", job: { tenantId: "tenant1" } },
    });
    db.jobSubmission.findUnique.mockResolvedValue(pendingSubmission);

    await expect(acceptJobReviewOffer(agent, "offer-bob")).rejects.toMatchObject({ status: 410 });

    expect(db.jobReviewOffer.updateMany).toHaveBeenCalledWith({
      where: { id: "offer-bob", status: "offered" },
      data: expect.objectContaining({ status: "expired", expiredAt: expect.any(Date) }),
    });
    expect(db.jobReviewOffer.findMany).toHaveBeenCalled();
  });

  it("does not replace an offer for a decided submission", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "sub1" }]);
    db.jobSubmission.findUnique.mockResolvedValue({ ...pendingSubmission, status: "accepted" });

    await expect(ensureJobReviewOffers("sub1")).resolves.toBe(0);
    expect(db.jobReviewOffer.create).not.toHaveBeenCalled();
  });
});

describe("reviewJobSubmission (#617)", () => {
  it("requires an accepted offer before a verdict (409)", async () => {
    db.jobReviewOffer.findFirst.mockResolvedValue(null);
    await expect(
      reviewJobSubmission(agent, "sub1", { verdict: "accept" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("an own-owner reviewer is refused (409)", async () => {
    db.jobSubmission.findUnique.mockResolvedValue({ ...submission, beneficiaryUserId: "owner-bob" });
    await expect(reviewJobSubmission(agent, "sub1", { verdict: "accept" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("a reject vetoes the submission immediately", async () => {
    db.jobReview.create.mockResolvedValue({ id: "review1", verdict: "reject" });
    const result = await reviewJobSubmission(agent, "sub1", { verdict: "reject" });
    expect(result.submission.status).toBe("rejected");
    expect(award).not.toHaveBeenCalled();
  });

  it("accepts and pays once when distinct owners reach the threshold", async () => {
    award.mockResolvedValue(true);
    db.jobReview.findMany.mockResolvedValue([
      { beneficiaryUserId: "owner-bob" },
      { beneficiaryUserId: "owner-carol" },
    ]);
    const result = await reviewJobSubmission(agent, "sub1", { verdict: "accept" });
    expect(result.submission.status).toBe("accepted");
    expect(result.points_awarded).toBe(10);
    expect(award).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        role: "submission",
        userId: "owner-ada",
        bugId: null,
        points: 10,
        sourceKey: "job:job1:submission:sub1",
      }),
    );
  });

  it("stays pending below the threshold", async () => {
    db.jobReview.findMany.mockResolvedValue([{ beneficiaryUserId: "owner-bob" }]);
    const result = await reviewJobSubmission(agent, "sub1", { verdict: "accept" });
    expect(result.submission.status).toBe("pending");
    expect(award).not.toHaveBeenCalled();
  });

  it("pays nothing when the ledger already has the row (idempotent)", async () => {
    award.mockResolvedValue(false);
    db.jobReview.findMany.mockResolvedValue([
      { beneficiaryUserId: "owner-bob" },
      { beneficiaryUserId: "owner-carol" },
    ]);
    const result = await reviewJobSubmission(agent, "sub1", { verdict: "accept" });
    expect(result.points_awarded).toBe(0);
  });

  it("refuses a second verdict from the same agent", async () => {
    db.jobReview.findFirst.mockResolvedValue({ id: "review1" });
    await expect(reviewJobSubmission(agent, "sub1", { verdict: "accept" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("409s once the submission is already decided", async () => {
    db.jobSubmission.findUnique.mockResolvedValue({ ...submission, status: "accepted" });
    await expect(reviewJobSubmission(agent, "sub1", { verdict: "accept" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("publishes job.submission.reviewed", async () => {
    await reviewJobSubmission(agent, "sub1", { verdict: "accept" });
    expect(publish).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ type: "job.submission.reviewed", tenantId: "tenant1" }),
    );
  });
});
