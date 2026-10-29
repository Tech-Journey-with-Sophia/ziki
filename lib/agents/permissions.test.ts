import { describe, expect, it } from "vitest";
import {
  AGENT_SCOPES,
  AgentScopeError,
  hasScope,
  requireScope,
  scopesForLevel,
} from "./permissions";
import { agentErrorResponse } from "./require-agent";

describe("Granular Permissions and Multi-Agent RBAC (#462)", () => {
  it("defines comprehensive granular scopes", () => {
    expect(AGENT_SCOPES).toContain("issues:read");
    expect(AGENT_SCOPES).toContain("issues:write");
    expect(AGENT_SCOPES).toContain("issues:triage");
    expect(AGENT_SCOPES).toContain("claims:create");
    expect(AGENT_SCOPES).toContain("claims:release");
    expect(AGENT_SCOPES).toContain("comments:write");
    expect(AGENT_SCOPES).toContain("validations:submit");
    expect(AGENT_SCOPES).toContain("merges:execute");
  });

  it("maps global levels to least-privilege default scopes", () => {
    const observerScopes = scopesForLevel("observer");
    expect(observerScopes).toEqual(["issues:read"]);

    const contributorScopes = scopesForLevel("contributor");
    expect(contributorScopes).toContain("issues:read");
    expect(contributorScopes).toContain("issues:write");
    expect(contributorScopes).toContain("comments:write");
    expect(contributorScopes).toContain("claims:create");
    expect(contributorScopes).toContain("claims:release");
    expect(contributorScopes).not.toContain("validations:submit");
    expect(contributorScopes).not.toContain("merges:execute");

    const reviewerScopes = scopesForLevel("reviewer");
    expect(reviewerScopes).toContain("validations:submit");
    expect(reviewerScopes).not.toContain("merges:execute");

    const mergerScopes = scopesForLevel("merger");
    expect(mergerScopes).toContain("merges:execute");
  });

  it("checks granted scopes via hasScope", () => {
    const observer = { level: "observer" as const };
    expect(hasScope(observer, "issues:read")).toBe(true);
    expect(hasScope(observer, "issues:write")).toBe(false);

    const contributor = { level: "contributor" as const };
    expect(hasScope(contributor, "issues:write")).toBe(true);
    expect(hasScope(contributor, "validations:submit")).toBe(false);

    // Custom restricted agent (e.g. triage-only)
    const triageOnly = { level: "contributor" as const, scopes: ["issues:read", "issues:triage"] };
    expect(hasScope(triageOnly, "issues:read")).toBe(true);
    expect(hasScope(triageOnly, "issues:triage")).toBe(true);
    expect(hasScope(triageOnly, "issues:write")).toBe(false);
  });

  it("enforces scopes via requireScope and throws AgentScopeError", () => {
    const observer = { level: "observer" as const };
    expect(() => requireScope(observer, "issues.list")).not.toThrow();
    expect(() => requireScope(observer, "issues.create")).toThrow(AgentScopeError);

    try {
      requireScope(observer, "issues.create");
    } catch (e) {
      expect(e).toBeInstanceOf(AgentScopeError);
      expect((e as AgentScopeError).requiredScope).toBe("issues:write");
      expect((e as AgentScopeError).code).toBe("forbidden_scope");
    }
  });

  it("produces standard HTTP 403 response in agentErrorResponse for AgentScopeError", async () => {
    const error = new AgentScopeError("merges:execute");
    const response = agentErrorResponse(error);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({
      error: "forbidden_scope",
      message: "This action requires the 'merges:execute' permission scope.",
      requiredScope: "merges:execute",
    });
  });
});
