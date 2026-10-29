/**
 * Canonical platform hierarchy and terminology (#441, #445).
 *
 * Defines the standardized 2-tier structural model:
 *   Tier 1: Organisation (top-level entity representing team/tenant)
 *   Tier 2: Platform (work grouping, e.g. Desktop, Web, Mobile, Backend)
 *
 * Phasing out redundant separate "Projects" and ambiguous "Workspace" terms.
 */

export const TAXONOMY = {
  ORGANISATION: {
    singular: "Organisation",
    plural: "Organisations",
    description: "The primary top-level entity representing the tenant/team.",
    legacyAliases: ["Workspace", "Tenant"],
    databaseModel: "Tenant",
    apiScopeParam: "organizationId",
    legacyParam: "tenantId",
  },
  PLATFORM: {
    singular: "Platform",
    plural: "Platforms",
    description: "The primary work grouping entity (e.g. Desktop, Mobile, Web, Backend).",
    legacyAliases: ["Category", "Project"],
    databaseModel: "Category",
    apiScopeParam: "platformId",
    legacyParam: "categoryId",
  },
} as const;

export type EntityTaxonomy = keyof typeof TAXONOMY;

export interface TaxonomyMigrationItem {
  legacyTerm: string;
  canonicalTerm: string;
  scope: "UI" | "API" | "Database" | "Documentation";
  status: "active" | "deprecated" | "planned_removal";
  notes: string;
}

export const TAXONOMY_MIGRATION_INVENTORY: readonly TaxonomyMigrationItem[] = [
  {
    legacyTerm: "Workspace",
    canonicalTerm: "Organisation",
    scope: "UI",
    status: "deprecated",
    notes: "UI copy standardized to 'Organisation'; 'Switch workspace' -> 'Switch organisation'.",
  },
  {
    legacyTerm: "Tenant",
    canonicalTerm: "Organisation",
    scope: "Database",
    status: "active",
    notes: "Database model remains 'Tenant' for zero-downtime backwards compatibility; user-facing interfaces expose 'Organisation'.",
  },
  {
    legacyTerm: "Project",
    canonicalTerm: "Platform",
    scope: "UI",
    status: "deprecated",
    notes: "Redundant Project silos flattened into Platforms; UI navigation and issue grouping focus on Platforms.",
  },
  {
    legacyTerm: "Category",
    canonicalTerm: "Platform",
    scope: "API",
    status: "deprecated",
    notes: "API endpoints accept both categoryId and platformId with graceful backwards compatibility.",
  },
];

/** Standardizes entity terms across UI copy and API definitions. */
export function canonicalEntityName(legacyTerm: string): string {
  const normalized = legacyTerm.trim().toLowerCase();
  if (
    normalized === "workspace" ||
    normalized === "tenant" ||
    normalized === "organization" ||
    normalized === "organisation"
  ) {
    return TAXONOMY.ORGANISATION.singular;
  }
  if (
    normalized === "project" ||
    normalized === "category" ||
    normalized === "platform"
  ) {
    return TAXONOMY.PLATFORM.singular;
  }
  return legacyTerm;
}

/** Returns the approved plural label for an entity. */
export function canonicalPluralName(legacyTerm: string): string {
  const canonical = canonicalEntityName(legacyTerm);
  if (canonical === TAXONOMY.ORGANISATION.singular) return TAXONOMY.ORGANISATION.plural;
  if (canonical === TAXONOMY.PLATFORM.singular) return TAXONOMY.PLATFORM.plural;
  return `${legacyTerm}s`;
}
