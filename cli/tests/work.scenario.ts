import { beforeAll, describe, expect, it } from "vitest";
import { readKeyring } from "../keyring";
import { fileIssue, ok, refused, ziki, type Agent } from "./helpers";

type Item = { kind: string; key: string; minimumRole: string; canAct: boolean; blockedReason?: string; points?: number; issue?: { id: string }; actions: { name: string; cli: string }[] };

/** The one work list every agent watches: `/<project-slug>/work`, or `pnpm ziki work`. */
describe("the work feed", () => {
  const agentIds = new Map<string, Agent>();
  let slug: string;

  beforeAll(async () => {
    for (const agent of ["ada", "bob", "cara", "dana", "eli"] as const) agentIds.set((await ok(agent, "whoami")).id, agent);
    slug = (await ok("ada", "whoami")).project_slug;
  });

  const work = async (agent: Agent) => (await ok(agent, "work")) as { items: Item[]; ask: string[]; workUrl: string; pollAfterSeconds: number; agent: { level: string } };
  const itemFor = (items: Item[], kind: string, issueId: string) => items.find((item) => item.kind === kind && item.issue?.id === issueId);
  const ideaPoints = async (agent: Agent, issueId: string) =>
    ((await ok(agent, "list-point-entries", { limit: 100 })).items as { role: string; points: number; issue: { id: string } | null }[])
      .filter((entry) => entry.role === "idea" && entry.issue?.id === issueId)
      .reduce((sum, entry) => sum + entry.points, 0);

  it("is what a connecting agent is told to watch", async () => {
    const me = await ok("bob", "whoami");
    expect(me.work_url).toMatch(new RegExp(`/${slug}/work$`));
    expect(me.next_step).toMatch(/work_url/);
    const feed = await work("bob");
    expect(feed.workUrl).toBe(me.work_url);
    expect(feed.pollAfterSeconds).toBe(30);
  });

  it("answers at the short URL, and 304 when nothing changed", async () => {
    const { serverUrl, agents } = readKeyring();
    const url = `${serverUrl}/${slug}/work`;
    const headers = { Authorization: `Bearer ${agents.bob.key}` };
    const first = await fetch(url, { headers });
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const again = await fetch(url, { headers: { ...headers, "If-None-Match": etag! } });
    expect(again.status).toBe(304);
    expect((await fetch(url, { headers: { Authorization: "Bearer ziki_not_a_key" } })).status).toBe(401);
  });

  it("shows a new idea at once, asks for opinions, and leaves it out of the reporter's own list", async () => {
    const idea = await fileIssue("ada", "Work feed: an idea for opinions");
    const bobs = await work("bob");
    const item = itemFor(bobs.items, "idea", idea);
    expect(item, "the new idea is in bob's list straight away").toBeTruthy();
    expect(item!.points).toBe(1);
    expect(item!.actions.map((action) => action.name)).toEqual(expect.arrayContaining(["validate_issue", "check_duplicate", "comment"]));
    expect(bobs.ask.join(" ")).toMatch(/opinion/);
    expect(itemFor((await work("ada")).items, "idea", idea)).toBeUndefined();
  });

  it("pays 1 point for the first opinion on an idea, once per person", async () => {
    const idea = await fileIssue("ada", "Work feed: an idea worth one point");
    await ok("bob", "comment", { id: idea, body: "This would help: the current flow loses the draft when the page reloads." });
    expect(await ideaPoints("bob", idea)).toBe(1);
    await ok("bob", "comment", { id: idea, body: "A second thought from the same owner should not pay a second point." });
    await ok("bob", "validate-issue", { id: idea, kind: "real", verdict: "accept", severity: "medium" });
    expect(await ideaPoints("bob", idea)).toBe(1);
    // Contributed, so no point is offered again; the duplicate check is still open.
    const item = itemFor((await work("bob")).items, "idea", idea);
    expect(item?.points).toBeUndefined();
  });

  it("pays nothing for a one-word comment, but a validation counts", async () => {
    const idea = await fileIssue("ada", "Work feed: short replies earn nothing");
    await ok("cara", "comment", { id: idea, body: "+1" });
    expect(await ideaPoints("cara", idea)).toBe(0);
    await ok("cara", "validate-issue", { id: idea, kind: "duplicate", verdict: "reject" });
    expect(await ideaPoints("cara", idea)).toBe(1);
  });

  it("never pays for an opinion on your own idea", async () => {
    const idea = await fileIssue("ada", "Work feed: my own idea");
    await ok("ada", "comment", { id: idea, body: "Adding detail to my own idea is fine but earns no idea point." });
    expect(await ideaPoints("ada", idea)).toBe(0);
  });

  it("lists offers to the agent and then its claim, with what to do next", async () => {
    const issue = await fileIssue("ada", "Work feed: an issue to offer");
    await ok("bob", "validate-issue", { id: issue, kind: "real", verdict: "accept", severity: "high" });
    await ok("cara", "validate-issue", { id: issue, kind: "real", verdict: "accept", severity: "high" });
    await ok("dana", "validate-issue", { id: issue, kind: "duplicate", verdict: "reject" });
    for (const agent of ["bob", "cara", "eli"] as const) await ok(agent, "vote", { id: issue });
    expect(itemFor((await work("bob")).items, "ready_issue", issue), "ready issues are listed to take").toBeTruthy();

    const { offer } = await ok("bob", "request-offer", { id: issue });
    const solver = agentIds.get(offer.agentId)!;
    const offered = (await work(solver)).items.find((item) => item.key === `offer:${offer.id}`);
    expect(offered?.actions[0].cli).toBe(`accept-offer --id ${offer.id}`);
    await ok(solver, "accept-offer", { id: offer.id });
    const claim = itemFor((await work(solver)).items, "active_claim", issue);
    expect(claim?.actions.map((action) => action.name)).toEqual(["heartbeat", "link_pull_request", "release_claim"]);
    await ok(solver, "release-claim", { id: issue, reason: "Done testing the feed." });
  });

  it("shows manager and merger tasks to everyone, but only lets those classes act", async () => {
    for (const agent of ["bob", "dana", "eli"] as const) {
      const feed = await work(agent);
      for (const item of feed.items) {
        const rank = { working: 0, manager: 1, merger: 2 } as Record<string, number>;
        if (rank[item.minimumRole] > rank[feed.agent.level]) {
          expect(item.canAct, `${agent} must not act on ${item.key}`).toBe(false);
          expect(item.blockedReason).toBe(`Needs a ${item.minimumRole} agent.`);
        }
        if (!item.canAct) expect(item.blockedReason).toBeTruthy();
      }
    }
    const roles = new Map((await work("bob")).items.map((item) => [item.kind, item.minimumRole]));
    if (roles.has("merge_fix")) expect(roles.get("merge_fix")).toBe("merger");
    if (roles.has("accept_fix")) expect(roles.get("accept_fix")).toBe("manager");
    if (roles.has("dispatch")) expect(roles.get("dispatch")).toBe("manager");
  });

  it("refuses another project's work and needs a key", async () => {
    await refused("bob", "work", { projectId: "no-such-project" }, 404);
    const unknown = await ziki("work", "--as", "zoe");
    expect(unknown.code).toBe(2);
  });
});
