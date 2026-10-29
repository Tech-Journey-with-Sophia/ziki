import { describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/lib/agents/require-agent";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { itemsFor, workEtag, type AgentWork, type ProjectWork, type WorkFeed } from "./work";

const agent = (level: AgentContext["level"], ownerId = "owner-bob"): AgentContext => ({
  agentId: `agent-${ownerId}`,
  name: "bob",
  ownerId,
  tenantId: "t1",
  level,
  burst: false,
  keyId: "k1",
  projectId: "p1",
});

const facts = (overrides: Partial<ProjectWork["facts"] extends Map<string, infer F> ? F : never> = {}) => ({
  reporterId: "owner-ada",
  beneficiaryUserId: "owner-ada",
  assigneeId: null,
  createdByAgentId: "agent-owner-ada",
  createdByAgent: { ownerUserId: "owner-ada" },
  pullRequestUrl: null,
  claims: [],
  validatorOwners: [],
  testerOwners: [],
  commenterIds: [],
  voterIds: [],
  ...overrides,
});

function work(overrides: Partial<ProjectWork> = {}): ProjectWork {
  return {
    tenantId: "t1",
    project: { id: "p1", slug: "ziki", name: "Ziki" },
    ideas: [],
    tests: [],
    ready: [],
    toAccept: [],
    toMerge: [],
    jobs: [],
    facts: new Map(),
    offerWindowSeconds: 1800,
    ...overrides,
  };
}

const nothingMine: AgentWork = { offers: [], reviewOffers: [], jobReviewOffers: [], claims: [], unread: 0 };

describe("itemsFor", () => {
  it("asks for an opinion on an idea, worth 1 point until the owner contributes", () => {
    const idea = { id: "b1", number: 7, title: "Activity as an icon", needs: ["validation", "duplicate_check"] as const };
    const fresh = itemsFor(agent("working"), work({ ideas: [{ ...idea, needs: [...idea.needs] }], facts: new Map([["b1", facts()]]) }), nothingMine);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ kind: "idea", points: 1, canAct: true, minimumRole: "working" });
    expect(fresh[0].actions.map((a) => a.name)).toEqual(["validate_issue", "check_duplicate", "comment"]);

    const commented = facts({ commenterIds: ["owner-bob"] });
    const after = itemsFor(agent("working"), work({ ideas: [{ ...idea, needs: [...idea.needs] }], facts: new Map([["b1", commented]]) }), nothingMine);
    expect(after[0].points).toBeUndefined();
  });

  it("drops an idea once the owner has done everything it still needs", () => {
    const done = facts({ validatorOwners: [{ kind: "real", ownerUserId: "owner-bob", onBehalfOfUserId: "owner-bob" }] });
    const items = itemsFor(agent("working"), work({ ideas: [{ id: "b1", number: 7, title: "x", needs: ["validation"] }], facts: new Map([["b1", done]]) }), nothingMine);
    expect(items).toEqual([]);
  });

  it("leaves out the agent's own ideas", () => {
    const own = facts({ reporterId: "owner-bob", beneficiaryUserId: "owner-bob", createdByAgent: { ownerUserId: "owner-bob" } });
    const items = itemsFor(agent("working"), work({ ideas: [{ id: "b1", number: 7, title: "x", needs: ["validation"] }], facts: new Map([["b1", own]]) }), nothingMine);
    expect(items).toEqual([]);
  });

  it("leaves out fixes the owner already tested at this pull request", () => {
    const pr = "https://github.com/emerjent/ziki/pull/1";
    const tested = facts({ pullRequestUrl: pr, testerOwners: [{ ownerUserId: "owner-bob", pullRequestUrl: pr }] });
    const items = itemsFor(agent("working"), work({ tests: [{ id: "b1", number: 7, title: "x", pullRequestUrl: pr }], facts: new Map([["b1", tested]]) }), nothingMine);
    expect(items).toEqual([]);
  });

  it("lists manager and merger work for a working agent without letting it act", () => {
    const project = work({
      ready: [{ id: "b1", number: 1, title: "x", voteCount: 3, severity: "high" }],
      toAccept: [{ id: "b2", number: 2, title: "y" }],
      toMerge: [{ id: "b3", number: 3, title: "z", reviewStatus: "ready_to_merge" }],
      facts: new Map([["b2", facts()], ["b3", facts()]]),
    });
    const items = itemsFor(agent("working"), project, nothingMine);
    const byKind = Object.fromEntries(items.map((item) => [item.kind, item]));
    expect(byKind.ready_issue).toMatchObject({ canAct: true, minimumRole: "working" });
    expect(byKind.dispatch).toMatchObject({ canAct: false, minimumRole: "manager", blockedReason: "Needs a manager agent." });
    expect(byKind.accept_fix).toMatchObject({ canAct: false, minimumRole: "manager" });
    expect(byKind.merge_fix).toMatchObject({ canAct: false, minimumRole: "merger", blockedReason: "Needs a merger agent." });

    const merger = Object.fromEntries(itemsFor(agent("merger"), project, nothingMine).map((item) => [item.kind, item]));
    expect(merger.dispatch.canAct).toBe(true);
    expect(merger.accept_fix.canAct).toBe(true);
    expect(merger.merge_fix.canAct).toBe(true);
  });

  it("blocks a manager from accepting a fix it is not independent of", () => {
    const own = facts({ reporterId: "owner-dana", beneficiaryUserId: "owner-dana" });
    const items = itemsFor(agent("manager", "owner-dana"), work({ toAccept: [{ id: "b2", number: 2, title: "y" }], facts: new Map([["b2", own]]) }), nothingMine);
    expect(items[0]).toMatchObject({ kind: "accept_fix", canAct: false });
    expect(items[0].blockedReason).toMatch(/Your owner/);
  });

  it("puts offers addressed to the agent first, with their deadline", () => {
    const offeredAt = new Date("2026-10-29T10:00:00Z");
    const mine: AgentWork = {
      ...nothingMine,
      offers: [{ id: "o1", offeredAt, bug: { id: "b9", number: 9, title: "Offered" } }],
    };
    const items = itemsFor(agent("working"), work({ ready: [{ id: "b1", number: 1, title: "x", voteCount: 3, severity: "high" }] }), mine);
    expect(items[0]).toMatchObject({ kind: "offer", key: "offer:o1", dueAt: "2026-10-29T10:30:00.000Z" });
    expect(items[0].actions[0]).toMatchObject({ name: "accept_offer", path: "/api/v1/offers/o1/accept", cli: "accept-offer --id o1" });
  });
});

describe("workEtag", () => {
  it("changes with the feed and stays the same for an equal one", () => {
    const feed = { items: [], ask: [] } as unknown as WorkFeed;
    expect(workEtag(feed)).toBe(workEtag({ ...feed }));
    expect(workEtag(feed)).not.toBe(workEtag({ ...feed, ask: ["new"] }));
    expect(workEtag(feed)).toMatch(/^W\/"[\w-]+"$/);
  });
});
