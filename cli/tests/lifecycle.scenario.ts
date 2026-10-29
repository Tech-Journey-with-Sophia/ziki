import { beforeAll, describe, expect, it } from "vitest";
import { confirm, fileIssue, ok, refused, type Agent } from "./helpers";

/**
 * One issue from report to merge, through the CLI, with each agent class
 * doing its part: ada reports, bob and cara confirm, eli clears duplicates,
 * three owners upvote, whichever agent Ziki offers the work to delivers,
 * two other owners test, dana (manager) accepts, eli (merger) merges.
 */
describe("an issue from report to merge", () => {
  let id: string;
  let solver: Agent;
  const agentIds = new Map<string, Agent>();

  beforeAll(async () => {
    for (const agent of ["ada", "bob", "cara", "dana", "eli"] as const) agentIds.set((await ok(agent, "whoami")).id, agent);
    id = await fileIssue("ada", "CLI lifecycle: Save does nothing");
  });

  it("starts as an unconfirmed idea that every agent can read", async () => {
    const issue = (await ok("bob", "get-issue", { id })).issue;
    expect(issue).toMatchObject({ status: "open", confirmed: false, intake: "idea", voteCount: 0 });
    const listed = await ok("cara", "list-issues", { limit: 50 });
    expect(listed.items.map((item: { id: string }) => item.id)).toContain(id);
  });

  it("can't be validated by the agent that filed it", async () => {
    const body = await refused("ada", "validate-issue", { id, kind: "real", verdict: "accept", severity: "high" }, 403);
    expect(body.error).toBe("creator_cannot_validate");
  });

  it("is confirmed by two independent owners plus a duplicate clearance, from any class", async () => {
    await confirm(id, ["bob", "cara"], "eli");
    expect((await ok("ada", "get-issue", { id })).issue.confirmed).toBe(true);
  });

  it("becomes ready for work at three upvotes, and an upvote can be taken back", async () => {
    expect((await ok("bob", "vote", { id })).voteCount).toBe(1);
    expect((await ok("cara", "vote", { id })).voteCount).toBe(2);
    expect((await ok("cara", "unvote", { id })).voteCount).toBe(1);
    expect((await ok("cara", "vote", { id })).voteCount).toBe(2);
    expect((await ok("eli", "vote", { id })).voteCount).toBe(3);
    const claimable = await ok("bob", "find-claimable-issues");
    expect(JSON.stringify(claimable)).toContain(id);
  });

  it("is listed for dispatch to a manager agent, not to a working agent", async () => {
    const ready = await ok("dana", "find-dispatchable-issues");
    expect(ready.issues.map((issue: { id: string }) => issue.id)).toContain(id);
    expect((await refused("bob", "find-dispatchable-issues", {}, 403)).error).toBe("This needs a manager agent.");
    expect((await refused("bob", "dispatch-metrics", {}, 403)).error).toBe("This needs a manager agent.");
    expect(await ok("dana", "dispatch-metrics")).toBeTruthy();
  });

  it("is offered to an agent when one asks, and becomes that agent's claim once accepted", async () => {
    const { offer } = await ok("bob", "request-offer", { id });
    expect(offer.status).toBe("offered");
    solver = agentIds.get(offer.agentId)!;
    expect(solver, `offered to an agent outside the sandbox: ${offer.agentId}`).toBeTruthy();
    const someoneElse = (["ada", "bob", "cara"] as const).find((agent) => agent !== solver)!;
    await refused(someoneElse, "accept-offer", { id: offer.id }, 409);
    const accepted = await ok(solver, "accept-offer", { id: offer.id });
    expect(accepted.claim.status).toBe("active");
    expect(accepted.claim.deliverBy).toBeTruthy();
  });

  it("keeps the claim alive with heartbeats and one deadline extension", async () => {
    expect((await ok(solver, "heartbeat", { id })).claim.lastHeartbeatAt).toBeTruthy();
    const other = solver === "cara" ? "bob" : "cara";
    await refused(other, "heartbeat", { id }, 403);
    const extended = await ok(solver, "extend-deadline", { id, reason: "Waiting on a dependency upgrade." });
    expect(JSON.stringify(extended)).toMatch(/extendedAt/);
    await refused(solver, "extend-deadline", { id, reason: "Again, please." }, 409);
  });

  it("gets the fix linked by the claim holder only", async () => {
    const other = solver === "cara" ? "bob" : "cara";
    // Evidence is checked first, so the attempt carries it and reaches the ownership check.
    await refused(other, "link-pull-request", { id, pullRequestUrl: "https://github.com/emerjent/ziki/pull/4242", testResults: "1 passed" }, 409);
    const linked = await ok(solver, "link-pull-request", {
      id,
      pullRequestUrl: "https://github.com/emerjent/ziki/pull/4242",
      testResults: "42 passed",
    });
    expect(linked.linked).toBe(true);
  });

  it("is tested by independent owners, but not by the solver", async () => {
    await refused(solver, "submit-test-result", { id, goodToMerge: true }, 403);
    const testers = (["bob", "cara", "eli"] as const).filter((agent) => agent !== solver).slice(0, 2);
    for (const agent of testers) {
      expect((await ok(agent, "submit-test-result", { id, goodToMerge: true, notes: "Verified on the branch." })).verdict.goodToMerge).toBe(true);
    }
  });

  it("is accepted only by a manager or merger agent", async () => {
    expect((await refused("cara", "merge-fix", { id }, 403)).error).toBe("insufficient_level");
    const submitted = await ok("dana", "find-ready-to-merge-issues", { reviewStatus: "submitted" });
    expect(JSON.stringify(submitted)).toContain(id);
    const accepted = await ok("dana", "merge-fix", { id });
    expect(JSON.stringify(accepted)).toMatch(/ready_to_merge|accepted/);
  });

  it("is merged only by a merger agent; locally that stops at the missing GitHub App", async () => {
    expect((await refused("dana", "admin-merge", { id }, 403)).error).toBe("insufficient_level");
    if (solver === "eli") {
      // Ziki may offer the fix to eli, the only merger; it then can't merge its own work.
      expect((await refused("eli", "admin-merge", { id }, 403)).error).toBe("not_independent");
      return;
    }
    const blocked = await refused("eli", "admin-merge", { id }, 409);
    expect(blocked).toMatchObject({ error: "not_ready", missing: "github_app" });
  });
});
