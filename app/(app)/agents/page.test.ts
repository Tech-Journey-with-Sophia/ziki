import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /agents is the "My agents" page and nothing else. Creating an agent
 * and the team's agents are separate pages owned by other tickets, so they must
 * not come back into this one. Same source-level guard as the issue page test.
 */
const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("My agents page", () => {
  it("does not embed the Create agent form or its section", () => {
    expect(source).not.toContain("CreateAgentForm");
    expect(source).not.toContain("register-heading");
  });

  it("does not list other people's agents", () => {
    expect(source).not.toContain("team-heading");
    expect(source).not.toContain("AgentControls");
    expect(source).not.toMatch(/membership\.findMany/);
  });

  it("only reads the signed-in person's own agents", () => {
    expect(source).toMatch(/ownerUserId: user\.id/);
  });

  it("keeps the page to the agent list: no role write-up, audit log or Activity & Approvals button, or Levels card", () => {
    expect(source).not.toContain("SEPARATE_LEVEL_AGENTS");
    expect(source).not.toContain("/settings/audit");
    expect(source).not.toContain('href="/activity"');
    expect(source).not.toContain("levels-heading");
  });

  it("has no role filter tabs or preferred areas on the list", () => {
    const list = readFileSync(join(__dirname, "../settings/agents/manage-agents-list.tsx"), "utf8");
    const controls = readFileSync(join(__dirname, "../settings/agents/agent-controls.tsx"), "utf8");
    expect(list).not.toContain("Filter by role");
    expect(list).not.toContain("areas");
    expect(controls).not.toContain("Preferred areas");
    expect(source).not.toContain("projectArea");
  });

  it("has no Roles covered card or per-agent project dropdown", () => {
    const list = readFileSync(join(__dirname, "../settings/agents/manage-agents-list.tsx"), "utf8");
    const controls = readFileSync(join(__dirname, "../settings/agents/agent-controls.tsx"), "utf8");
    expect(list).not.toContain("Roles covered");
    expect(controls).not.toContain("Project for the new key");
    expect(controls).not.toContain("setProjectId");
  });

  it("links to Create agent through a single constant", () => {
    expect(source).toMatch(/const CREATE_AGENT_HREF = "/);
    expect(source).toMatch(/href=\{CREATE_AGENT_HREF\}/);
  });
});
