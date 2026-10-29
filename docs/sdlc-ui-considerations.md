# Autonomous Multi-Agent SDLC: Frontend & UI Architecture Considerations

## 1. Executive Summary

With the introduction of the **Autonomous Multi-Agent Software Engineering Lifecycle (SDLC)** on Ziki, issues transition through fine-grained verification and integration stages:
- **`open`**: Unassigned or cleared for bidding.
- **`in_progress`**: Claimed or actively being implemented by an assigned agent.
- **`submitted`**: Pull request linked with submission evidence (screenshots and test execution logs).
- **`ready_to_merge`**: A manager agent has verified mergeability and test verdicts, awaiting deployment.
- **`rejected`**: A manager agent rejected the PR, logging an anti-pattern to the shared Mistake Registry.
- **`merged`**: A merger agent verified GitHub Actions deployment checks and merged the PR.

While the backend database schema (`reviewStatus`, `AgentMistake`), REST API routes, and MCP tools are fully in place, the web interface requires accompanying UI enhancements to make this autonomous lifecycle transparent, inspectable, and actionable for human engineers and maintainers.

---

## 2. SDLC Review Status Chips & Visual Stepper

### 2.1 Problem
Previously, issues only presented coarse status (`open`, `in_progress`, `resolved`, `closed`). When an agent claimed an issue, the UI showed a generic "Someone is working on it" message, regardless of whether the PR was in code review, approved, or rejected.

### 2.2 UI Specification
- **Issue Detail Header (`app/(app)/issues/[id]/page.tsx`)**:
  - Render an explicit **SDLC Phase Badge** alongside the severity and stage chips:
    - `reviewStatus === "submitted"`: `In Review` (Indigo badge, pulse indicator).
    - `reviewStatus === "ready_to_merge"`: `Ready to Merge` (Emerald/Green badge with merge icon).
    - `reviewStatus === "rejected"`: `Needs Revision` (Amber badge with alert icon).
    - `reviewStatus === "merged"`: `Merged` (Purple badge with checkmark).
- **Lifecycle Stepper**:
  - A subtle 4-step progress bar on the issue page:
    `[Claimed] ➔ [Submitted & Tested] ➔ [Manager Approved] ➔ [Deployed]`

---

## 3. Submission Evidence Viewer (Screenshots & Test Results)

### 3.1 Problem
Agents submit fixes with two critical pieces of verification evidence via `POST /api/v1/issues/{id}/github`:
1. `screenshots`: URLs to image proofs of the fix.
2. `testResults`: Structured test execution logs, pass/fail status, and coverage metrics.
Without UI rendering, human maintainers have to inspect raw activity JSON to view this evidence.

### 3.2 UI Specification
- **Component**: `SubmissionEvidence` (`components/submission-evidence.tsx`).
- **Screenshots Gallery**:
  - Thumbnail preview grid with lazy loading.
  - Click-to-expand lightbox modal for high-resolution visual comparison.
- **Test Results Console**:
  - Collapsible terminal-style viewer with syntax highlighting or summary breakdown:
    - Test Suite: e.g. `Vitest / Jest / Pytest`
    - Status: `Passed: 18, Failed: 0, Skipped: 1`
    - Execution Duration: `1.42s`
    - Raw output collapsible accordion.

---

## 4. Project Mistake Knowledge Base & Anti-Pattern Explorer

### 4.1 Problem
When manager agents reject fixes, they record anti-patterns and remediations into `AgentMistake` in PostgreSQL. Human engineers need to view these insights to understand systemic defects and onboard new team members.

### 4.2 UI Specification
- **Navigation**:
  - Add a **"Mistake Registry"** / **"Anti-Patterns"** view under `/projects/[slug]/settings` or `/projects/[slug]/mistakes`.
- **Card Layout**:
  - Grouping by `MistakeCategory`: `correctness`, `efficiency`, `completeness`, `mergeability`, `architecture`, `security`.
  - **Recurrence Counter**: Badge showing how many times this mistake was encountered (e.g. `Repeated 4x`).
  - **Code Comparison**: Side-by-side or stacked diff blocks:
    - *Anti-Pattern Code* (Red background / strikethrough)
    - *Remediation Code* (Green background)
  - **Associated Issues**: Deep links to tickets where this mistake occurred.

---

## 5. Two-Stage Merge & GitHub Actions CI/CD Controls

### 5.1 Problem
The SDLC separates **manager review** (a manager agent checking test verdicts and mergeability) from **merge execution** (a merger agent running the Git merge and verifying GitHub Actions deployment). The web UI must support both manual and agent-driven workflows.

### 5.2 UI Specification
- **Manager Controls**:
  - When 2 independent test verdicts pass on a linked PR, render **"Accept Fix (Ready to Merge)"** and **"Reject with Feedback"** action buttons for authorized maintainers.
- **Merger Deployment Bar**:
  - When `reviewStatus === "ready_to_merge"`, display an **"Execute Admin Merge"** action.
  - **Live GitHub Actions Indicator**:
    - Query check-runs on the PR head commit.
    - Status: 🟢 Green (Ready to merge), 🟡 Running (Deploy/Test in progress), 🔴 Failed (Merge blocked).
    - If checks are not green, display descriptive banner explaining that CI/CD deployment checks must pass first.

---

## 6. Issue List Filtering & Status Indicators

### 6.1 Problem
Maintainers and agents browsing the main Issues list (`/issues`) need to immediately find PRs ready for review or ready for merge without clicking each ticket.

### 6.2 UI Specification
- **`IssueRowStatus` (`components/issue-row-status.tsx`)**:
  - If `reviewStatus === "submitted"`, show: `[BotIcon] PR Submitted · In Review`.
  - If `reviewStatus === "ready_to_merge"`, show: `[CheckIcon] Ready to Merge`.
  - If `reviewStatus === "rejected"`, show: `[AlertIcon] Revision Requested`.
- **Issue Filter Dropdown (`components/issue-filters.tsx` & `lib/issue-list-filters.ts`)**:
  - Add `reviewStatus` query parameter support:
    - `?reviewStatus=submitted`: Tickets awaiting test verdicts and manager review.
    - `?reviewStatus=ready_to_merge`: Tickets ready for deployment merge.
    - `?reviewStatus=rejected`: Tickets needing rework by the solver.

---

## 7. Timeline & Agent Decision Summaries

### 7.1 Problem
`AgentDecisionsSummary` currently displays `confirmed`, `claimed`, and `verdict`. It needs to display the full SDLC lifecycle events.

### 7.2 UI Specification
- **Decision Cards**:
  - **Rejected Fix Card**: Red/Amber chip stating "Manager agent rejected the fix" with a preview of the anti-pattern title and a link to the project mistake registry.
  - **Ready to Merge Card**: Purple chip indicating "Manager agent approved fix for Git merge".
  - **Final Merge Card**: Green chip indicating "Merger agent merged pull request #X and verified CI/CD deployment".

---

## 8. Human-in-the-Loop (HITL) Architectural Review Gate

### 8.1 Problem
Features or issues that fundamentally alter product philosophy or architecture should not be auto-dispatched to agents without product lead sign-off.

### 8.2 UI Specification
- **Approval Banner (`components/issue-approval-banner.tsx`)**:
  - When flagged, display a high-priority **"Product / Architectural Review Required"** banner at the top of the issue.
  - Visual indicator that autonomous bidding and claim dispatching are paused until human approval is recorded.
  - One-click "Approve Direction" or "Decline & Close" actions for workspace admins.

---

## 9. Implementation Status & Shipped Components

The core UI components and integration points for the Autonomous Multi-Agent SDLC are now fully implemented and merged:

| Component | Path | Purpose |
| --- | --- | --- |
| `ReviewStatusBadge` | [`components/review-status-badge.tsx`](../components/review-status-badge.tsx) | Renders badges for `submitted`, `ready_to_merge`, `rejected`, and `merged` across issue details and link previews. |
| `SubmissionEvidence` | [`components/submission-evidence.tsx`](../components/submission-evidence.tsx) | Thumbnail screenshot gallery and collapsible terminal test runner output viewer. |
| `ProjectMistakesView` | [`components/project-mistakes-view.tsx`](../components/project-mistakes-view.tsx) | Interactive explorer for the Agent Mistake Registry with category filtering, recurrence badges, and code diffs. |
| `IssueRowStatus` | [`components/issue-row-status.tsx`](../components/issue-row-status.tsx) | Live pulsing indicators and status chips on the main issue list. |
| `parseBugListFilters` | [`lib/issue-list-filters.ts`](../lib/issue-list-filters.ts) | Filter parsing support for `reviewStatus`. |
| Prisma Migration | [`prisma/migrations/20261106000000_...`](../prisma/migrations/20261106000000_agent_sdlc_lifecycle_and_mistakes/migration.sql) | PostgreSQL schema definitions for `reviewStatus`, `AgentMistake`, and the former `admin_merger` level (now the `merger` class, migrated in `20261127000000_agent_classes`). |

