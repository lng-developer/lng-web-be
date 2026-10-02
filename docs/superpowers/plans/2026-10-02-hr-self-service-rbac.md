# HR Self-Service RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every authenticated employee can open the HR self-service workspace and see only their own profile, attendance, leave/overtime requests, and payslips without receiving broad HR or operational permissions.

**Architecture:** Keep backend enforcement unchanged: authenticated `/api/hr/*/me` endpoints derive identity from `req.auth`, while list and management endpoints remain permission-gated. Correct the frontend workspace selector so the `self` workspace is unconditional; all other workspaces continue to require their existing permissions.

**Tech Stack:** React, TypeScript, Vitest, existing Express/Mongoose HR APIs.

**Spec:** `docs/superpowers/specs/2026-10-02-hr-self-service-rbac-design.md`

## Global Constraints

- Do not assign the existing `USER` role to all accounts and do not mutate account, role, or access-assignment data.
- Do not add any permission to enable personal HR access.
- Preserve authorization for team, operations, payroll, list, and management routes.
- Reuse the existing `/me` API clients; do not add endpoints or dependencies.

## Review Focus

- A session with no `HR_*` permission still receives every `/hr/me/*` navigation entry and defaults to `/hr/me`.
- No manager/team/operations/payroll navigation appears in that session.
- Existing backend guards for non-`/me` HR APIs are unchanged.

---

### Task 1: Make the self workspace unconditional in frontend navigation

**Files:**
- Modify: `C:\Users\stack\Task\lng-web-fe\src\features\hr\hrViews.ts`
- Modify: `C:\Users\stack\Task\lng-web-fe\src\test\hr\hrViews.test.ts`

- [ ] **Step 1: Write the failing test**

  In `hrViews.test.ts`, assert that `getHrWorkspaces([])` returns only `self` and does not include `team`, `operations`, or `payroll`.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- --runInBand src/test/hr/hrViews.test.ts`

  Expected: the empty-permissions assertion fails because `self` currently requires one of four HR write permissions.

- [ ] **Step 3: Implement the smallest fix**

  In `hrViews.ts`, remove the permission requirement from the `self` workspace entry. Leave the three privileged workspace entries and their permission arrays unchanged.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `npm test -- --runInBand src/test/hr/hrViews.test.ts`

  Expected: self workspace is always available; privileged workspaces remain hidden without grants.

### Task 2: Lock the no-permission navigation contract

**Files:**
- Modify: `C:\Users\stack\Task\lng-web-fe\src\test\hr\hrNavigation.test.ts`

- [ ] **Step 1: Write the failing test**

  Add a no-permission case asserting `getHrNavigation([])` contains exactly the six `/hr/me` routes and `getDefaultHrPath([])` is `/hr/me`.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- --runInBand src/test/hr/hrNavigation.test.ts`

  Expected: it fails before Task 1 because no workspace is selected for an empty permission set.

- [ ] **Step 3: Reuse the Task 1 behavior; do not add a second access rule**

  Do not change `hrNavigation.ts` unless the test exposes an independent defect. Its existing `getHrWorkspaces()` call should inherit the unconditional self workspace.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `npm test -- --runInBand src/test/hr/hrNavigation.test.ts`

  Expected: a normal employee gets personal navigation only; manager navigation remains permission-based.

### Task 3: Verify the complete bounded HR contract

**Files:**
- Verify only: `C:\Users\stack\Task\lng-web-fe\src\features\hr\api\hrTimeApi.ts`
- Verify only: `C:\Users\stack\Task\lng-web-fe\src\features\hr\pages\Attendance\useAttendance.tsx`
- Verify only: `C:\Users\stack\Task\lng-web-fe\src\features\hr\pages\TimeRequests\useTimeRequest.tsx`
- Verify only: `C:\Users\stack\Task\lng-web-fe\src\features\hr\hooks\useHrQueries.ts`
- Verify only: `C:\Users\stack\Task\lng-web-be\src\modules\hr\routes\index.js`

- [ ] **Step 1: Verify personal data clients remain self-scoped**

  Confirm attendance, time requests, payroll, workspace, and employee profile self paths use their existing `/me` endpoints when corresponding read permission is absent.

- [ ] **Step 2: Verify the backend remains authorization-safe**

  Confirm the listed `/me` routes require authentication and derive the employee identity server-side, while list/manager routes retain their existing permission guards.

- [ ] **Step 3: Run the HR navigation test pair**

  Run: `npm test -- --runInBand src/test/hr/hrViews.test.ts src/test/hr/hrNavigation.test.ts`

  Expected: all assertions pass.

- [ ] **Step 4: Review the diff before delivery**

  Run: `git diff -- src/features/hr/hrViews.ts src/test/hr/hrViews.test.ts src/test/hr/hrNavigation.test.ts`

  Expected: only the unconditional self workspace plus its regression tests; no role, DB, API, or privileged-route changes.
