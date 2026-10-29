import { describe, expect, it } from "vitest";
import { backfillEntries, backfillPoints, parseBackfillArgs, type HistoricalBug } from "./backfill";
import { standingValidationAwards } from "@/lib/agent-api/validation";
import { CONFIRMATION_REVIEWER_POINTS, reviewerPointsAt } from "./rules";

const bug = (overrides: Partial<HistoricalBug>): HistoricalBug => ({
  id: "bug-1",
  tenantId: "tenant-zedu",
  status: "resolved",
  severity: "medium",
  assigneeId: "solver-1",
  reporterId: "reporter-1",
  duplicateOfId: null,
  isDeleted: false,
  ...overrides,
});

/** Bugs and a ledger with a unique sourceKey, paged the way Prisma pages. */
function fixture(bugs: HistoricalBug[]) {
  const ledger: Array<{ sourceKey: string; role: string; points: number; userId: string }> = [];
  const sorted = [...bugs].sort((a, b) => a.id.localeCompare(b.id));
  const db = {
    bug: {
      findMany: async ({ take, cursor }: { take: number; cursor?: { id: string } }) => {
        const start = cursor ? sorted.findIndex((b) => b.id === cursor.id) + 1 : 0;
        return sorted.slice(start, start + take);
      },
    },
    pointEntry: {
      findMany: async ({ where }: { where: { sourceKey: { in: string[] } } }) =>
        ledger.filter((row) => where.sourceKey.in.includes(row.sourceKey)),
      createMany: async ({ data }: { data: typeof ledger }) => {
        let count = 0;
        for (const row of data) {
          if (ledger.some((r) => r.sourceKey === row.sourceKey)) continue;
          ledger.push(row);
          count++;
        }
        return { count };
      },
    },
  };
  return { db: db as never, ledger };
}

describe("backfill points (#435)", () => {
  describe("rules for one old ticket", () => {
    it("gives a resolved, assigned, non-duplicate bug one solver and one reporter entry", () => {
      expect(backfillEntries(bug({}))).toEqual([
        {
          tenantId: "tenant-zedu",
          userId: "solver-1",
          bugId: "bug-1",
          role: "solver",
          points: 750,
          sourceKey: "solver:bug-1:solver-1",
        },
        {
          tenantId: "tenant-zedu",
          userId: "reporter-1",
          bugId: "bug-1",
          role: "reporter",
          points: 150,
          sourceKey: "reporter:bug-1:reporter-1",
        },
      ]);
    });

    it("uses platform/project reward amounts when provided", () => {
      const rewardConfig = {
        solver: { low: 7, medium: 10, high: 20, critical: 40 },
        reporter: 7,
        reviewer: 12,
        guidelines: null,
      };
      expect(backfillEntries(bug({}), { rewardConfig })).toMatchObject([
        { role: "solver", points: 10 },
        { role: "reporter", points: 7 },
      ]);
    });

    it("counts closed like resolved, by the issue's severity", () => {
      expect(backfillEntries(bug({ status: "closed", severity: "critical" }))[0]).toMatchObject({
        role: "solver",
        points: 1800,
      });
    });

    it("gives a bug with no assignee reporter points only", () => {
      expect(backfillEntries(bug({ assigneeId: null })).map((e) => e.role)).toEqual(["reporter"]);
    });

    it("gives an unfinished bug reporter points only", () => {
      expect(backfillEntries(bug({ status: "in_progress" })).map((e) => e.role)).toEqual(["reporter"]);
    });

    it("never gives a duplicate reporter points", () => {
      expect(backfillEntries(bug({ duplicateOfId: "bug-0", assigneeId: null }))).toEqual([]);
      // Still assigned and resolved: the solver did the work, the report wasn't new.
      expect(backfillEntries(bug({ duplicateOfId: "bug-0" })).map((e) => e.role)).toEqual(["solver"]);
    });

    it("gives a deleted bug nothing", () => {
      expect(backfillEntries(bug({ isDeleted: true }))).toEqual([]);
    });

    it("invents no reviewer points", () => {
      expect(backfillEntries(bug({})).some((e) => e.role === "reviewer")).toBe(false);
    });

    it("gives an unconfirmed modern agent issue no reporter points (#715)", () => {
      expect(
        backfillEntries(
          bug({ createdByAgentId: "agent-1", isConfirmed: false, status: "open", assigneeId: null }),
        ),
      ).toEqual([]);
    });

    it("gives a confirmed modern agent issue reporter points to the beneficiary (#715)", () => {
      expect(
        backfillEntries(
          bug({
            createdByAgentId: "agent-1",
            beneficiaryUserId: "user-bene",
            reporterId: "user-agent-owner",
            isConfirmed: true,
            status: "open",
            assigneeId: null,
          }),
        ),
      ).toEqual([
        {
          tenantId: "tenant-zedu",
          userId: "user-bene",
          bugId: "bug-1",
          role: "reporter",
          points: 150,
          sourceKey: "reporter:bug-1:user-bene",
        },
      ]);
    });

    it("requires confirmation for issues created on or after the cutoff date (#715)", () => {
      const cutoff = new Date("2026-10-21T00:00:00Z");
      const unconfirmed = bug({
        createdAt: new Date("2026-10-21T12:00:00Z"),
        isConfirmed: false,
        assigneeId: null,
      });
      expect(backfillEntries(unconfirmed, { cutoffDate: cutoff })).toEqual([]);

      const confirmed = bug({
        createdAt: new Date("2026-10-21T12:00:00Z"),
        isConfirmed: true,
        assigneeId: null,
      });
      expect(backfillEntries(confirmed, { cutoffDate: cutoff })).toMatchObject([
        { role: "reporter", points: 150 },
      ]);

      const prePlatform = bug({
        createdAt: new Date("2026-10-20T12:00:00Z"),
        isConfirmed: false,
        assigneeId: null,
      });
      expect(backfillEntries(prePlatform, { cutoffDate: cutoff })).toMatchObject([
        { role: "reporter", points: 150 },
      ]);
    });
  });

  it("lists one solver and one reporter line in a dry run, and writes nothing", async () => {
    const { db, ledger } = fixture([bug({})]);
    const lines: string[] = [];

    const result = await backfillPoints(db, { dryRun: true, onLine: (l) => lines.push(`${l.role}:${l.points}`) });

    expect(lines).toEqual(["solver:750", "reporter:150"]);
    expect(result).toEqual({ bugs: 1, planned: 2, written: 0, existing: 0 });
    expect(ledger).toEqual([]);
  });

  it("writes the entries, and a second run inserts nothing", async () => {
    const { db, ledger } = fixture([bug({}), bug({ id: "bug-2", assigneeId: null })]);

    expect(await backfillPoints(db)).toEqual({ bugs: 2, planned: 3, written: 3, existing: 0 });
    expect(ledger).toHaveLength(3);

    expect(await backfillPoints(db)).toEqual({ bugs: 2, planned: 3, written: 0, existing: 3 });
    expect(ledger).toHaveLength(3);
  });

  it("doesn't pay again for a ticket that already earned a real award", async () => {
    const { db, ledger } = fixture([bug({})]);
    ledger.push({ sourceKey: "solver:bug-1:solver-1", role: "solver", points: 25, userId: "solver-1" });

    const lines: boolean[] = [];
    const result = await backfillPoints(db, { onLine: (l) => lines.push(l.alreadyAwarded) });

    expect(lines).toEqual([true, false]);
    expect(result).toMatchObject({ written: 1, existing: 1 });
    expect(ledger.filter((r) => r.role === "solver")).toHaveLength(1);
  });

  it("counts an award that loses a race to a real one as already awarded", async () => {
    const { db, ledger } = fixture([bug({ assigneeId: null })]);
    // Another process writes the key after the lookup, so the lookup misses it.
    const lookup = (db as { pointEntry: { findMany: unknown } }).pointEntry;
    lookup.findMany = async () => [];
    ledger.push({ sourceKey: "reporter:bug-1:reporter-1", role: "reporter", points: 5, userId: "reporter-1" });

    const lines: boolean[] = [];
    const result = await backfillPoints(db, { onLine: (l) => lines.push(l.alreadyAwarded) });

    expect(result).toEqual({ bugs: 1, planned: 1, written: 0, existing: 1 });
    expect(lines).toEqual([true]);
  });

  it("walks every ticket across batches", async () => {
    const bugs = Array.from({ length: 7 }, (_, i) => bug({ id: `bug-${i}`, assigneeId: null }));
    const { db, ledger } = fixture(bugs);
    expect(await backfillPoints(db, { batchSize: 3 })).toMatchObject({ bugs: 7, written: 7 });
    expect(ledger).toHaveLength(7);
  });
});

describe("standingValidationAwards (#539)", () => {
  const loadedBug = {
    id: "bug-1",
    tenantId: "tenant-zedu",
    projectId: "p1",
    title: "t",
    status: "open",
    assigneeId: null,
    voteCount: 0,
    severity: "medium",
    reporterId: "reporter-1",
    beneficiaryUserId: null,
    duplicateOfId: null,
    createdByAgentId: null,
    createdByAgent: null,
    claims: [],
  };

  const val = (kind: string, verdict: string, userId: string, level = "working") => ({
    id: `v-${kind}-${verdict}-${userId}`,
    kind,
    verdict,
    onBehalfOfUserId: userId,
    agent: { id: `a-${userId}`, ownerUserId: userId, level },
  });

  function dbWith(validations: ReturnType<typeof val>[], bugOverrides: Record<string, unknown> = {}) {
    const match = (where: { kind?: string; verdict?: string }) =>
      validations.filter(
        (v) => (!where.kind || v.kind === where.kind) && (!where.verdict || v.verdict === where.verdict),
      );
    return {
      bug: { findUnique: async () => ({ ...loadedBug, ...bugOverrides }) },
      issueValidation: {
        findMany: async ({ where }: { where: { kind?: string; verdict?: string } }) => match(where),
        count: async ({ where }: { where: { kind?: string; verdict?: string } }) => match(where).length,
      },
      agentAuditEvent: { findMany: async () => [] },
    } as never;
  }

  it("pays counted real accepts at the diminishing reviewer rate", async () => {
    const db = dbWith([val("real", "accept", "u1"), val("real", "accept", "u2")]);
    expect(await standingValidationAwards(db, "bug-1")).toEqual([
      { tenantId: "tenant-zedu", userId: "u1", bugId: "bug-1", role: "reviewer", points: reviewerPointsAt(0, CONFIRMATION_REVIEWER_POINTS), sourceKey: "reviewer-confirm:bug-1:u1" },
      { tenantId: "tenant-zedu", userId: "u2", bugId: "bug-1", role: "reviewer", points: reviewerPointsAt(1, CONFIRMATION_REVIEWER_POINTS), sourceKey: "reviewer-confirm:bug-1:u2" },
    ]);
  });

  it("pays a standing triager clearance and a duplicate marker, once per person", async () => {
    const db = dbWith([
      val("duplicate", "reject", "u3"),
      val("duplicate", "reject", "u3"),
      val("duplicate", "reject", "u4", "manager"), // any class earns a clearance
      val("duplicate", "accept", "u5"),
    ]);
    const entries = await standingValidationAwards(db, "bug-1");
    expect(entries).toContainEqual({
      tenantId: "tenant-zedu", userId: "u3", bugId: "bug-1", role: "triager", points: 30, sourceKey: "triager-clear:bug-1:u3",
    });
    expect(entries).toContainEqual({
      tenantId: "tenant-zedu", userId: "u5", bugId: "bug-1", role: "triager", points: 150, sourceKey: "duplicate-marker:bug-1:u5",
    });
    expect(entries).toContainEqual({
      tenantId: "tenant-zedu", userId: "u4", bugId: "bug-1", role: "triager", points: 30, sourceKey: "triager-clear:bug-1:u4",
    });
    expect(entries.filter((e) => e.userId === "u3")).toHaveLength(1);
    expect(entries).toHaveLength(3);
  });

  it("pays no confirming reviewers once a duplicate marker stands", async () => {
    const db = dbWith([val("real", "accept", "u1"), val("duplicate", "accept", "u5")]);
    const entries = await standingValidationAwards(db, "bug-1");
    expect(entries.map((e) => e.sourceKey)).toEqual(["duplicate-marker:bug-1:u5"]);
  });

  it.each(["reject", "accept"])("keeps a standing duplicate %s award after its triager later becomes the solver (#579)", async (verdict) => {
    const validation = val("duplicate", verdict, "u3");
    const expected = await standingValidationAwards(dbWith([validation]), "bug-1");
    expect(expected).toHaveLength(1);
    const claimedDb = dbWith([validation], {
      status: "in_progress",
      assigneeId: "u3",
      claims: [{ status: "active", releasedAt: null, beneficiaryUserId: "u3", agent: { ownerUserId: "u3" } }],
    });
    expect(await standingValidationAwards(claimedDb, "bug-1")).toEqual(expected);
  });

  it.each(["reject", "accept"])("still excludes a duplicate %s award credited to the reporter (#579)", async (verdict) => {
    const validation = {
      ...val("duplicate", verdict, "reporter-1"),
      agent: { id: "a-independent-triager", ownerUserId: "independent-triager", level: "working" },
    };
    const db = dbWith([validation]);
    expect(await standingValidationAwards(db, "bug-1")).toEqual([]);
  });

  it("returns nothing when the db lacks the validation delegates (test doubles)", async () => {
    const { db } = fixture([bug({})]);
    expect(await standingValidationAwards(db, "bug-1")).toEqual([]);
  });
});

describe("backfill script arguments (#435)", () => {
  it("accepts --dry-run, which also prints every line", () => {
    expect(parseBackfillArgs(["--dry-run"])).toEqual({ ok: true, dryRun: true, verbose: true });
  });

  it("runs for real only with no flags or --verbose", () => {
    expect(parseBackfillArgs([])).toEqual({ ok: true, dryRun: false, verbose: false });
    expect(parseBackfillArgs(["--verbose"])).toEqual({ ok: true, dryRun: false, verbose: true });
  });

  it("refuses a mistyped flag instead of writing", () => {
    for (const typo of ["--dryrun", "--dry_run", "-n", "dry-run"]) {
      const parsed = parseBackfillArgs([typo]);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain(typo);
    }
  });

  it("refuses an unknown flag next to a valid one", () => {
    expect(parseBackfillArgs(["--dry-run", "--force"]).ok).toBe(false);
  });

  it("accepts valid --cutoff flag and rejects invalid ones (#715)", () => {
    const valid = parseBackfillArgs(["--cutoff=2026-10-21T00:00:00Z"]);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.cutoffDate?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    }

    const validSpace = parseBackfillArgs(["--cutoff", "2026-10-21T00:00:00Z", "--dry-run"]);
    expect(validSpace.ok).toBe(true);
    if (validSpace.ok) {
      expect(validSpace.cutoffDate?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
      expect(validSpace.dryRun).toBe(true);
    }

    expect(parseBackfillArgs(["--cutoff"]).ok).toBe(false);
    expect(parseBackfillArgs(["--cutoff", "--dry-run"]).ok).toBe(false);
    expect(parseBackfillArgs(["--cutoff=not-a-date"]).ok).toBe(false);
    expect(parseBackfillArgs(["--cutoff", "not-a-date"]).ok).toBe(false);
  });

  it("rejects invalid cutoff Date object in backfillPoints (#715)", async () => {
    const { db } = fixture([]);
    await expect(backfillPoints(db, { cutoffDate: new Date("invalid") })).rejects.toThrow(
      "Invalid cutoffDate provided to backfillPoints",
    );
  });
});
