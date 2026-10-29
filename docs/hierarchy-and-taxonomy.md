# Hierarchy and Terminology Specification

Standardizing on **Organisation** and **Platforms** (#441, #445).

---

## 1. Executive Summary

Ziki previously utilized four overlapping, ambiguous organizational concepts:
- **Workspaces** (UI colloquialism)
- **Tenants** (Database entity)
- **Organisations** (Team/Business entity)
- **Projects** (Nested product silos)
- **Categories** (Platform tags like Desktop, Web, Mobile)

This multi-layer structure caused confusion for human contributors and AI agents alike, creating ambiguous permission boundaries and disjointed navigation.

### The Standardized 2-Tier Hierarchy

The architecture is standardized into a clean, intuitive **2-tier hierarchy**:

```
┌────────────────────────────────────────────────────────┐
│                      ORGANISATION                      │
│   (Top-level boundary for members, agents, settings)   │
└───────────────────────────┬────────────────────────────┘
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
         ┌───────────┐             ┌───────────┐
         │ PLATFORM  │             │ PLATFORM  │
         │   (Web)   │             │ (Desktop) │
         └─────┬─────┘             └─────┬─────┘
               │                         │
        Issues & Claims           Issues & Claims
```

1. **Organisation** (Tier 1): The top-level administrative and billing boundary. Owns all members, teams, autonomous agents, API keys, and settings.
2. **Platform** (Tier 2): The primary classification for categorizing work (e.g. Web, Desktop, Mobile, Backend). Issues and claims belong directly to an Organisation and are grouped across Platforms.

The redundant, deeply nested **Projects** hierarchy is phased out and flattened directly into Platforms.

---

## 2. Terminology Glossary

| Canonical Term | Deprecated / Legacy Aliases | Scope & Definition |
| :--- | :--- | :--- |
| **Organisation** | *Workspace*, *Tenant* | **Top-level entity.** The shared organization/team account. Represents the root security and billing domain. |
| **Platform** | *Category*, *Project* | **Work grouping entity.** Represents the technical target or product surface (e.g., Desktop, Mobile, Web, CLI). |
| **Issue** | *Bug*, *Task* | A single work item, report, or idea tracked within an Organisation and categorized by Platform. |
| **Agent** | *Bot*, *Worker* | An autonomous worker registered to a user or organisation with defined execution levels and capabilities. |
| **Member** | *User* (in team context) | An individual authenticated user belonging to an Organisation with an assigned role. |

---

## 3. Migration Inventory

### 3.1 User Interface (UI) Copy
- **Workspace Switcher**: Standardized from `"Switch workspace"` to `"Switch organisation"` across headers and navigation.
- **Settings**: Separated cleanly into `"Personal Account Settings"` and `"Organisation Settings"`.
- **Issue Grouping**: Filter tabs consistently read `"Platforms"` (Desktop, Web, Mobile, etc.) rather than mixing Projects and Categories.

### 3.2 Route Paths and URLs
| Current Path | Canonical Path | Migration & Compatibility Status |
| :--- | :--- | :--- |
| `/tenants` | `/tenants` (aliased to `/organisations`) | Active. Displays "Organisations" heading with backward-compatible URLs. |
| `/admin/categories` | `/admin/categories` (aliased to `/admin/platforms`) | Active. Form controls labeled "Platforms". |
| `/settings` | `/settings` | Enhanced with `?tab=personal` and `?tab=organization`. |

### 3.3 API Endpoints & Parameters
| Parameter | Canonical Parameter | Support Policy |
| :--- | :--- | :--- |
| `tenantId` | `organizationId` | Both supported in query params and request bodies. `tenantId` supported indefinitely for API stability. |
| `categoryId` | `platformId` | Both supported across issue ingestion and filtering routes. |
| `projectId` | Flattened to `organizationId` + `platformId` | Legacy `projectId` mapped to default project per organisation to guarantee zero downtime. |

---

## 4. Backwards Compatibility Policy

1. **Database Schema Stability**: The underlying PostgreSQL schema retains `Tenant` and `Category` tables to ensure zero migration downtime and binary compatibility with existing migration history.
2. **Graceful Parameter Translation**: API gateways automatically accept both legacy and canonical parameters (`categoryId` $\leftrightarrow$ `platformId`, `tenantId` $\leftrightarrow$ `organizationId`).
3. **Deprecation Headers**: Legacy endpoint calls return standard HTTP `Deprecation: @2026-10-22` and `Link: <canonical-url>; rel="successor-version"` headers without breaking client execution.
