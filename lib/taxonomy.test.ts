import { describe, expect, it } from "vitest";
import {
  TAXONOMY,
  TAXONOMY_MIGRATION_INVENTORY,
  canonicalEntityName,
  canonicalPluralName,
} from "./taxonomy";

describe("Taxonomy and Hierarchy (#441, #445)", () => {
  it("defines 2-tier hierarchy: Organisation and Platform", () => {
    expect(TAXONOMY.ORGANISATION.singular).toBe("Organisation");
    expect(TAXONOMY.ORGANISATION.plural).toBe("Organisations");
    expect(TAXONOMY.ORGANISATION.legacyAliases).toContain("Workspace");
    expect(TAXONOMY.ORGANISATION.legacyAliases).toContain("Tenant");

    expect(TAXONOMY.PLATFORM.singular).toBe("Platform");
    expect(TAXONOMY.PLATFORM.plural).toBe("Platforms");
    expect(TAXONOMY.PLATFORM.legacyAliases).toContain("Project");
    expect(TAXONOMY.PLATFORM.legacyAliases).toContain("Category");
  });

  it("normalizes legacy aliases to canonical entity names", () => {
    expect(canonicalEntityName("workspace")).toBe("Organisation");
    expect(canonicalEntityName("tenant")).toBe("Organisation");
    expect(canonicalEntityName("organization")).toBe("Organisation");
    expect(canonicalEntityName("organisation")).toBe("Organisation");

    expect(canonicalEntityName("project")).toBe("Platform");
    expect(canonicalEntityName("category")).toBe("Platform");
    expect(canonicalEntityName("platform")).toBe("Platform");

    expect(canonicalEntityName("unknown")).toBe("unknown");
  });

  it("provides canonical plural entity names", () => {
    expect(canonicalPluralName("workspace")).toBe("Organisations");
    expect(canonicalPluralName("tenant")).toBe("Organisations");
    expect(canonicalPluralName("project")).toBe("Platforms");
    expect(canonicalPluralName("category")).toBe("Platforms");
  });

  it("contains complete migration inventory", () => {
    expect(TAXONOMY_MIGRATION_INVENTORY.length).toBeGreaterThanOrEqual(4);
    const legacyTerms = TAXONOMY_MIGRATION_INVENTORY.map((item) => item.legacyTerm);
    expect(legacyTerms).toContain("Workspace");
    expect(legacyTerms).toContain("Project");
    expect(legacyTerms).toContain("Tenant");
    expect(legacyTerms).toContain("Category");
  });
});
