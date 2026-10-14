# Team-leader HR scope implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Track each step with its checkbox.

**Goal:** Give a team leader read-only HR visibility for members of their assigned team, while retaining every employee's self-service HR access and never exposing another team's data or compensation.

**Architecture:** The backend remains the authorization boundary: it resolves the requested team from global or team-scoped grants before querying any HR read model. The frontend receives global permissions and team scopes separately, so it can show the read-only Team workspace without mistaking a scoped HR permission for global HR Operations access. The role update and live-data assignment are an idempotent, explicit two-phase script: dry-run by default, `--apply` only after the database target and counts are confirmed.

**Tech Stack:** Node.js/Express/CommonJS, Mongoose, Jest; React/TypeScript/Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-team-leader-hr-scope-design.md`

## Global constraints

- Keep the existing self-service routes available to every authenticated employee.
- A `LEADER` assignment grants HR access only when its scope is `team`; do not add global HR permissions to the leader or to `TEAM_LEADER`.
- A scoped leader may read only employee roster, schedule, attendance, leave, and overtime for their own team. They may not approve, edit, view payroll/compensation, or query another team.
- The client only hides unavailable navigation. The backend must reject a forged `teamId` before calling any downstream HR service.
- Preserve existing global HR administrator/operator behavior and all unrelated dirty changes.
- Do not execute the migration in apply mode, seed RBAC globally, or change live accounts until the target database name and dry-run totals have been shown and the user separately approves the write.

## Review focus

- Test both omitted and forged `teamId` inputs; the latter must be `403`, not an empty or partially filtered response.
- Ensure role permissions are read-only: no `HR_LEAVE:APPROVE`, `HR_OVERTIME:APPROVE`, `HR_SCHEDULE:WRITE`, `HR_ATTENDANCE:MANAGE`, `HR_PAYROLL:*`, or `HR_COMPENSATION:*`.
- Ensure a team-scoped `HR_EMPLOYEES:READ` does not reveal the global HR Operations workspace in the FE.

---

## Task 1: Enforce team scope inside the HR workspace service

**Files:**
- Modify: `src/modules/hr/services/workspace.service.js`
- Modify: `src/modules/hr/services/workspace.validator.js` only if the existing optional `teamId` validation cannot distinguish an omitted ID from an invalid one
- Test: `tests/hr/services/workspace.service.test.js`

- [ ] Add focused failing service tests with mocked downstream read services for these cases:
  - a single-team scoped leader omits `teamId` and every downstream roster/schedule/attendance/leave/overtime call receives that sole team ID;
  - the same leader requests a different team ID and receives `403` before any downstream call;
  - a user with no eligible team-scoped HR read permission receives `403`;
  - a user with a global HR read grant preserves the current cross-team query behavior;
  - a user with several eligible team scopes must select one of those IDs.
- [ ] In `workspace.service.js`, add a small private resolver used only by `getTeamWorkspace`. It must derive (not trust) the effective `teamId` from `authContext.permissions` for global access and from `authContext.scopes` where `scopeType === 'team'` for the allowed scoped teams. Its relevant permission set is `HR_EMPLOYEES:READ`, `HR_SCHEDULE:READ`, `HR_ATTENDANCE:READ`, `HR_LEAVE:READ`, and `HR_OVERTIME:READ`.
- [ ] Use the resolver's team filter for every downstream query. Leave the existing route-level `authorizeAnyPermission` as an early coarse guard; it is not the data-isolation guard.
- [ ] Return `AppError` with a stable forbidden status/code for absent, ambiguous, or foreign team scope. Do not leak the list of other team IDs.
- [ ] Run `node -c src/modules/hr/services/workspace.service.js` and `npm run test:hr -- --runInBand` (or the repository's narrow equivalent) after the focused Jest test passes.

## Task 2: Make HR navigation scope-aware instead of using flattened permissions

**Files:**
- Modify: `C:\Users\stack\Task\lng-web-fe\src\features\hr\hrViews.ts`
- Modify: `C:\Users\stack\Task\lng-web-fe\src\features\hr\hrNavigation.ts`
- Modify: `C:\Users\stack\Task\lng-web-fe\src\features\hr\pages\HrModulePage.tsx`
- Modify: `C:\Users\stack\Task\lng-web-fe\src\app\layout\appNavigation.ts`
- Test: `C:\Users\stack\Task\lng-web-fe\src\test\hr\hrViews.test.ts`
- Test: `C:\Users\stack\Task\lng-web-fe\src\test\hr\hrNavigation.test.ts`
- Test: `C:\Users\stack\Task\lng-web-fe\src\test\app\layout\appNavigation.test.ts`

- [ ] Introduce one minimal HR-access input built from `CurrentAccount`: global `permissions`, and permissions aggregated only from `team` scopes. Do not use `effectivePermissions()`/`getPermissions()` for this decision because it intentionally flattens scoped grants.
- [ ] Change `getHrWorkspaces`, `getHrNavigation`, and `getDefaultHrPath` to consume that input. Keep the personal workspace unconditional; enable Team only with a qualifying team-scoped read grant or the existing appropriate global HR read grant; enable Operations and Payroll only from global permissions.
- [ ] Update `HrModulePage` to get the current account from the workspace route loader rather than storage's flattened `getPermissions()`. Update `appNavigation.ts` to pass its existing `CurrentAccount` object through the same access adapter.
- [ ] Make the Team navigation read-only for the leader's exact permissions: overview, schedule, attendance, requests, and members. Do not surface any approval-only route/action; remove or separately gate the current `team-approvals` label if it means approval rather than viewing requests.
- [ ] Extend the Vitest cases to prove: (1) no-permission staff still receives all six self routes, (2) one scoped leader receives self plus the five allowed Team routes, (3) that leader never receives Operations, Payroll, or an approval route, and (4) a global HR employee-read grant can still receive Operations.
- [ ] Run `npx vitest run --project unit src/test/hr/hrViews.test.ts src/test/hr/hrNavigation.test.ts src/test/app/layout/appNavigation.test.ts` and TypeScript/lint verification appropriate to the modified FE files.

## Task 3: Define the reusable scoped leader role and an opt-in migration

**Files:**
- Modify: `src/modules/auth/scripts/seedRbac.js`
- Add: `src/modules/auth/scripts/migrateTeamLeaderHrScopes.js`
- Add/modify: the nearest existing auth script test file, or add `tests/auth/scripts/migrateTeamLeaderHrScopes.test.js`
- Reuse: `src/modules/auth/services/authAdmin.service.js` (`ensureTeamLeaderAssignment`) and the organization/auth public ports or existing script repository pattern; do not cross-import another module's internal model.

- [ ] Add failing tests for the migration planner: it identifies only current organization team leaders, plans the scoped `LEADER` assignment once per `(account, team)`, and performs no writes without `--apply`.
- [ ] Adjust the seeded `LEADER` capability list to contain the five read-only HR permissions from Task 1, adding `HR_EMPLOYEES:READ` and removing HR leave/overtime approval permissions. Keep unrelated existing Leader capabilities unchanged unless they create an HR write/approval path.
- [ ] Implement the migration as a small script with a dry-run default. It must print the resolved database name, the intended `LEADER` role permission delta, team-leader account/team totals, already-correct assignments, and proposed changes. `--apply` performs only the targeted role update and idempotent team `LEADER` assignments.
- [ ] Preserve global `TEAM_LEADER` and other unrelated roles; do not grant global HR permissions, and do not delete assignments. The migrated Vương Văn Oai record must become a scoped leader of the Sales team based on real organization membership, not by hard-coded email.
- [ ] Run the focused script tests plus `npm run test:auth -- --runInBand` and `npm run test:architecture -- --runInBand`.

## Task 4: Verify safely, then prepare the controlled production-data step

**Files:**
- Verify changed files from Tasks 1–3; no new production code unless a failed test reveals a contract mismatch.

- [ ] Run syntax checks for changed CommonJS files, the focused backend and frontend tests, and `git diff --check` in both repositories.
- [ ] Run the migration in dry-run mode only after reading the active environment configuration enough to report the exact database name. Capture only aggregate totals and assignment IDs/counts; do not print salary, attendance, or user PII.
- [ ] Compare dry-run results with the expected Sales leader membership. If membership cannot be determined or totals are surprising, stop rather than applying any database change.
- [ ] Report the exact database target and dry-run totals to the user and request explicit approval for `--apply`. A separate approval is required even if all code verification passes.
- [ ] After an approved apply, re-login as the leader in local/staging UI and verify: personal HR routes remain, Team shows only that team, a forged other-team request gets `403`, and payroll/operations remain unavailable.

## Completion evidence

- Backend scope tests prove no foreign-team data can be queried.
- FE navigation tests prove scoped permissions do not masquerade as global HR administration.
- RBAC script tests prove dry-run safety and assignment idempotency.
- Database writes, if later authorized, have a recorded target DB name and dry-run totals before `--apply`.
