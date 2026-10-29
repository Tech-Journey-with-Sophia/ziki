import type { AgentLevel } from "@prisma/client";

/**
 * Granular permission scopes for multi-agent RBAC (#462).
 */
export const AGENT_SCOPES = [
  "issues:read",
  "issues:write",
  "issues:triage",
  "claims:create",
  "claims:release",
  "comments:write",
  "validations:submit",
  "merges:execute",
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

export const AGENT_SCOPE_DESCRIPTIONS: Record<AgentScope, string> = {
  "issues:read": "List, search, and view issues, activities, and feeds.",
  "issues:write": "Create new issues and update issue descriptions.",
  "issues:triage": "Flag duplicates and update triage status.",
  "claims:create": "Place bids and claim issues for active execution.",
  "claims:release": "Extend claim deadlines, pause, or release claims.",
  "comments:write": "Post comments and questions on issues.",
  "validations:submit": "Submit issue validations, test verdicts, and redesign proposals.",
  "merges:execute": "Submit pull request links and execute verification merge checks.",
};

/**
 * Default scopes mapped from legacy global levels.
 * Guarantees 100% backward compatibility for all existing agents.
 */
export const LEVEL_DEFAULT_SCOPES: Record<AgentLevel, readonly AgentScope[]> = {
  observer: ["issues:read"],
  contributor: ["issues:read", "issues:write", "comments:write", "claims:create", "claims:release"],
  triager: ["issues:read", "issues:write", "comments:write", "claims:create", "claims:release", "issues:triage"],
  reviewer: ["issues:read", "issues:write", "comments:write", "claims:create", "claims:release", "issues:triage", "validations:submit"],
  merger: ["issues:read", "issues:write", "comments:write", "claims:create", "claims:release", "issues:triage", "validations:submit", "merges:execute"],
  dispatcher: ["issues:read", "issues:write", "comments:write", "claims:create", "claims:release", "issues:triage", "validations:submit", "merges:execute"],
};

export function scopesForLevel(level: AgentLevel): AgentScope[] {
  return [...(LEVEL_DEFAULT_SCOPES[level] ?? ["issues:read"])];
}

/** Error thrown when an agent lacks a required granular scope (HTTP 403). */
export class AgentScopeError extends Error {
  readonly requiredScope: AgentScope;
  readonly code = "forbidden_scope" as const;

  constructor(requiredScope: AgentScope) {
    super(`This action requires the '${requiredScope}' permission scope.`);
    this.name = "AgentScopeError";
    this.requiredScope = requiredScope;
  }
}

/** Action-to-Scope mapping for API gateway enforcement. */
export const ACTION_REQUIRED_SCOPES: Record<string, AgentScope> = {
  "issues.read": "issues:read",
  "issues.list": "issues:read",
  "issues.search": "issues:read",
  "issues.feed": "issues:read",
  "issues.create": "issues:write",
  "issues.update": "issues:write",
  "issues.triage": "issues:triage",
  "duplicates.mark": "issues:triage",
  "duplicates.clear": "issues:triage",
  "claims.create": "claims:create",
  "claims.bid": "claims:create",
  "claims.release": "claims:release",
  "claims.extend": "claims:release",
  "comments.create": "comments:write",
  "validations.submit": "validations:submit",
  "verdicts.submit": "validations:submit",
  "redesigns.propose": "validations:submit",
  "merges.execute": "merges:execute",
  "issues.github": "merges:execute",
};

/**
 * Checks whether an agent possesses the required scope.
 * Scopes act as an additional least-privilege restriction on top of levels.
 */
export function hasScope(
  agent: { level: AgentLevel; scopes?: readonly string[] | null },
  scope: AgentScope,
): boolean {
  if (!(AGENT_SCOPES as readonly string[]).includes(scope)) {
    return true;
  }
  const granted = agent.scopes ? agent.scopes : scopesForLevel(agent.level);
  return granted.includes(scope);
}

/**
 * Enforces that an agent has the required scope for a given action.
 * Throws AgentScopeError (HTTP 403) if missing.
 */
export function requireScope(
  agent: { level: AgentLevel; scopes?: readonly string[] | null },
  actionOrScope: string,
): void {
  const isDirectScope = (AGENT_SCOPES as readonly string[]).includes(actionOrScope);
  const required = ACTION_REQUIRED_SCOPES[actionOrScope] ?? (isDirectScope ? (actionOrScope as AgentScope) : undefined);
  if (!required) return; // If action is unmapped and not an explicit known scope, level check suffices
  if (!hasScope(agent, required)) {
    throw new AgentScopeError(required);
  }
}
