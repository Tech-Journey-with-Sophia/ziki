import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentLevelError,
  AGENT_LEVELS,
  AGENT_LEVEL_LABELS,
  DEFAULT_AGENT_LEVEL,
  LEGACY_AGENT_LEVELS,
  OWNER_REVIEW_LIMIT,
  SELF_REGISTRATION_LEVELS,
  SEPARATE_LEVEL_AGENTS,
  canSetLevel,
  hasLevel,
  isAgentLevel,
  normalizeAgentLevel,
  requireLevel,
  settableLevels,
} from "./levels";

describe("agent classes", () => {
  it("are three classes on a ladder: working, manager, merger", () => {
    expect(AGENT_LEVELS).toEqual(["working", "manager", "merger"]);
    expect(DEFAULT_AGENT_LEVEL).toBe("working");
  });

  it("lets each class do everything the classes below it can", () => {
    const allowed = (level: (typeof AGENT_LEVELS)[number]) => AGENT_LEVELS.filter((required) => hasLevel(level, required));
    expect(allowed("working")).toEqual(["working"]);
    expect(allowed("manager")).toEqual(["working", "manager"]);
    expect(allowed("merger")).toEqual(["working", "manager", "merger"]);
  });

  it("requireLevel throws a 403-shaped error naming the class needed", () => {
    expect(() => requireLevel({ level: "working" }, "working")).not.toThrow();
    expect(() => requireLevel({ level: "merger" }, "manager")).not.toThrow();
    try {
      requireLevel({ level: "working" }, "manager");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentLevelError);
      expect((error as AgentLevelError).required).toBe("manager");
      expect((error as Error).message).toBe("This needs a manager agent.");
    }
  });

  it("lets an owner set only working; a tenant admin sets any class", () => {
    expect(settableLevels({ isOwner: true, isTenantAdmin: false })).toEqual(["working"]);
    expect(settableLevels({ isOwner: false, isTenantAdmin: true })).toEqual(["working", "manager", "merger"]);
    expect(settableLevels({ isOwner: false, isTenantAdmin: false })).toEqual([]);
    expect(canSetLevel({ isOwner: true, isTenantAdmin: false }, "manager")).toBe(false);
    expect(canSetLevel({ isOwner: true, isTenantAdmin: false }, "merger")).toBe(false);
  });

  it("lets an agent register itself only as a working agent", () => {
    expect(SELF_REGISTRATION_LEVELS).toEqual(["working"]);
  });

  it("maps every old role name to its class", () => {
    expect(LEGACY_AGENT_LEVELS).toEqual({
      observer: "working",
      contributor: "working",
      triager: "working",
      reviewer: "working",
      dispatcher: "manager",
      admin_merger: "merger",
    });
    for (const name of ["observer", "contributor", "triager", "reviewer"]) expect(normalizeAgentLevel(name)).toBe("working");
    expect(normalizeAgentLevel("dispatcher")).toBe("manager");
    expect(normalizeAgentLevel("admin_merger")).toBe("merger");
    // A current name means what the docs say today.
    expect(normalizeAgentLevel("merger")).toBe("merger");
    expect(normalizeAgentLevel("manager")).toBe("manager");
    expect(normalizeAgentLevel("admin")).toBeNull();
    expect(normalizeAgentLevel("constructor")).toBeNull();
    expect(normalizeAgentLevel(undefined)).toBeNull();
  });

  it("recognises only real classes, so a forged body can't set one", () => {
    expect(isAgentLevel("merger")).toBe(true);
    expect(isAgentLevel("admin_merger")).toBe(false);
    expect(isAgentLevel("contributor")).toBe(false);
    expect(isAgentLevel("admin")).toBe(false);
    expect(isAgentLevel(undefined)).toBe(false);
  });

  it("labels classes as agents, so they can't be mistaken for people's Owner/Admin/Member roles", () => {
    for (const label of Object.values(AGENT_LEVEL_LABELS)) expect(label).toMatch(/ agent$/);
  });

  it("explains the classes without weakening review independence", () => {
    expect(SEPARATE_LEVEL_AGENTS).toMatch(/working agent/);
    expect(SEPARATE_LEVEL_AGENTS).toMatch(/manager/i);
    expect(SEPARATE_LEVEL_AGENTS).toMatch(/merger/i);
    expect(SEPARATE_LEVEL_AGENTS).toMatch(/not independent reviewers/);
    expect(OWNER_REVIEW_LIMIT).toMatch(/not an independent reviewer/);
    expect(OWNER_REVIEW_LIMIT).toMatch(/ticket you filed/);
    const doc = readFileSync(path.resolve(__dirname, "../../docs/ziki-for-agents.md"), "utf8");
    expect(doc).toContain("Independence is by **owner**, not by agent");
  });
});
