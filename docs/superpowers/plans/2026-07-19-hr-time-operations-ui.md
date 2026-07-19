# HR Time Operations UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver secure, readable HR Time Operations APIs and role-appropriate operational screens for staff, approvers, attendance operators, schedulers, and HR people administrators.

**Architecture:** Correct authorization and response projections in `lng-web-be` before creating UI. Responses expose display summaries, scoped summaries, and per-record capabilities. `lng-web-fe` consumes those contracts through a new feature and the existing operations layout components; business actions remain feature-local.

**Tech Stack:** Node/Express/Mongoose, existing auth public port, React 19, React Router 7, TanStack Query 5, MUI 9, Tailwind 4, react-hook-form, zod, react-i18next.

## Global Constraints

- Do not modify unrelated dirty order/production files in `lng-web-be`.
- Keep all API calls through `apiClient` and `ENDPOINTS`; do not add dependencies.
- Backend permissions and response `capabilities` gate UI. Never branch on role names.
- No normal screen displays raw IDs, raw JSON, or ID-entry inputs.
- Use batched enrichments/aggregations; no per-row employee/team/shift lookup.
- Reuse `src/components/operations/*` before adding shared UI.

---

## Task 1: Lock down scope and employee-profile privacy

**Files:**
- Modify: `src/modules/hr/services/employeeProfile.service.js`
- Modify: `src/modules/hr/repositories/employeeProfile.repository.js`
- Modify: `src/modules/hr/services/schedule.service.js`
- Modify: `src/modules/hr/routes/index.js`
- Modify: `src/modules/hr/dtos/employeeProfile.dto.js`
- Test: `src/test/hr/services/employeeProfile.service.test.js`
- Test: `src/test/hr/services/schedule.service.test.js`

- [ ] Add failing tests proving a department/team-scoped employee reader cannot receive a profile outside scope, and a scoped schedule writer cannot mutate a global configuration record.
- [ ] Split the profile DTO into a directory projection and a permission-gated detail projection. Remove PII, dependants, contract numbers, `baseCurrency`, and compensation fields from the directory projection.
- [ ] Apply scope filters before profile list/detail data is returned. Preserve `/employee-profiles/me` as self-service and prevent it from exposing compensation data without the existing compensation permission.
- [ ] Add `baseCurrency` to the same sensitive-field policy as salary and allowances.
- [ ] Apply authenticated scope to schedule assignment and calendar-override reads/writes. Keep global configuration mutations (shift/location/global override) restricted to globally authorized schedule writers.
- [ ] Run the two focused suites.

Example policy test shape:

```js
await assert.rejects(
  () => employeeProfileService.getProfile({ profileId: otherDepartmentProfileId, auth }),
  { code: 'FORBIDDEN' },
)
```

Commit: `fix(hr): enforce scope and profile privacy`

## Task 2: Add readable summary DTOs and backend capabilities

**Files:**
- Modify: `src/modules/hr/dtos/attendance.dto.js`
- Modify: `src/modules/hr/dtos/leave.dto.js`
- Modify: `src/modules/hr/dtos/overtime.dto.js`
- Modify: `src/modules/hr/dtos/schedule.dto.js`
- Modify: `src/modules/hr/dtos/employeeProfile.dto.js`
- Modify: `src/modules/hr/services/attendance.service.js`
- Modify: `src/modules/hr/services/leave.service.js`
- Modify: `src/modules/hr/services/overtime.service.js`
- Modify: `src/modules/hr/services/schedule.service.js`
- Modify: relevant repositories under `src/modules/hr/repositories/`
- Test: `src/test/hr/dtos/*.test.js`
- Test: `src/test/hr/services/leave.service.test.js`
- Test: `src/test/hr/services/overtime.service.test.js`

- [ ] First add DTO tests that require employee, department/team, shift, location, and calendar-scope labels when the relation exists.
- [ ] Add one batched profile/organization resolver per service call. Resolve all IDs for a page in one query per entity type, then pass a lookup map to the DTO mapper.
- [ ] Return `employee`, `department`, `team`, `shift`, `workLocation`, and `scopeTarget` summaries. Keep IDs as mutation metadata only.
- [ ] Add `capabilities` to leave/overtime/attendance/schedule rows using the same rules the mutation methods enforce. Do not duplicate rule logic in controllers.
- [ ] Add tests for own-request cancellation, non-self approval, terminal requests, and scoped approver behavior.

Example DTO result:

```js
{
  id: requestId,
  employee: { id: profileId, employeeCode: 'EMP-001', fullName: 'Nguyen Van A' },
  status: 'PENDING',
  capabilities: { view: true, approve: true, reject: true, cancel: false },
}
```

Commit: `feat(hr): return operator-ready time records`

## Task 3: Add scoped queue summaries and query-contract tests

**Files:**
- Modify: `src/modules/hr/repositories/leaveRequest.repository.js`
- Modify: `src/modules/hr/repositories/overtimeRequest.repository.js`
- Modify: `src/modules/hr/repositories/attendance.repository.js`
- Modify: `src/modules/hr/repositories/shiftAssignment.repository.js`
- Modify: `src/modules/hr/services/leave.service.js`
- Modify: `src/modules/hr/services/overtime.service.js`
- Modify: `src/modules/hr/services/attendance.service.js`
- Modify: `src/modules/hr/services/schedule.service.js`
- Test: `src/test/hr/services/leave.service.test.js`
- Test: `src/test/hr/services/overtime.service.test.js`
- Test: `src/test/hr/services/attendance.service.test.js`
- Test: `src/test/hr/services/schedule.service.test.js`

- [ ] Add failing tests asserting `summary.statusCounts` is computed across the complete filtered, scoped result set, not just the current page.
- [ ] Add optional `summary` to list responses for leave, overtime, attendance, and assignments.
- [ ] Reuse each list’s validated filters in the aggregate pipeline/query. Include only counts the corresponding screen renders.
- [ ] Verify a scoped user’s list total and all summary counts cannot include another scope’s data.

Example response shape:

```js
return { items, pagination, summary: { total, statusCounts } }
```

Commit: `feat(hr): add scoped time queue summaries`

## Task 4: Validate contracts with authenticated probes and regression tests

**Files:**
- Modify: `src/services/endpoints.contract.test.js` only if the repository keeps HR endpoint contracts there
- Add or modify: `src/test/hr/routes/*.test.js`
- Add: `docs/superpowers/specs/2026-07-19-hr-time-operations-api-examples.md`

- [ ] Use a local authenticated global HR account and a scoped account to capture sanitized real responses for employee list/detail, attendance, leave, overtime, assignments, and calendar overrides.
- [ ] Assert all normal list endpoints preserve `{ success, data: { items, pagination } }` and that new `summary`/`capabilities` fields match the specification.
- [ ] Assert the directory response has no prohibited PII keys.
- [ ] Record only redacted example payloads in the API examples document.
- [ ] Run focused HR route/service/DTO tests before moving to frontend work.

Commit: `test(hr): lock down operator response contracts`

## Task 5: Revise the correct Stitch HR project from the approved contract

**Project:** `LNG HR Time Operations UX (lng-web-be)` (`5225092921176592818`)

- [ ] Update the five screens: My Time, Request Inbox, Attendance Desk, Schedule, and People.
- [ ] Use human-readable employee/organization summaries and capability-gated row actions from Tasks 1-3.
- [ ] Keep the Linear + Asana-table operational direction: a compact header, queue tabs only where summary counts exist, a single filter toolbar, fixed table header, and purpose-specific dialogs.
- [ ] Show staff versus manager/HR affordances without adding an Admin-only visual mode.
- [ ] Add empty, loading, error, permission-restricted, and no-action states to each screen.
- [ ] Capture screenshots and record their Stitch screen IDs in the API examples document.

No application code change is made in this task.

## Task 6: Add the frontend HR Time API feature and routes

**Files:**
- Modify: `C:/Users/stack/Task/lng-web-fe/src/services/endpoints.js`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/constants/routes.js`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/routes/index.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/api/hrTime.keys.js`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/api/hrTime.queries.js`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/api/hrTime.mutations.js`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/utils/hrTimeApi.js`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/utils/hrTimeApi.test.js`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/i18n/locales/en/common.json`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/i18n/locales/vi/common.json`

- [ ] Add `ENDPOINTS.HR` constants for the real `/api/hr` routes; no literal URLs in page files.
- [ ] Build mapper functions for each backend row. Prefer `employee.fullName`, `department.name`, `shift.name`, and `workLocation.name`; use `Unknown employee` only when the response genuinely has no relation.
- [ ] Add query keys that include only active query parameters. Use debounced search and `keepPreviousData`/placeholder data so a filter change does not blank the whole page.
- [ ] Add mutation hooks that invalidate the closest list/detail key and the relevant summary key after success.
- [ ] Add unit tests for mapper output, query normalisation, and capabilities-to-actions mapping.

Example query key:

```js
listLeave: (params) => ['hr-time', 'leave', normalizeQuery(params)],
```

Commit: `feat(hr-ui): add HR time API feature`

## Task 7: Build staff and approver workflows

**Files:**
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/pages/MyTimePage.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/pages/RequestInboxPage.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/TimeRequestTable.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/RequestReviewDrawer.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/LeaveRequestDialog.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/OvertimeRequestDialog.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/RequestDecisionDialog.jsx`

- [ ] Use `OperationsPageShell`, `OperationsTabs`, `OperationsToolbar`, `OperationsTable`, and `OperationsPagination`; do not fork table/fixed-scroll behavior.
- [ ] Implement My Time with Today, Leave, Overtime, and History. Show only self-service actions returned by capability data.
- [ ] Implement Request Inbox with separate Leave and Overtime tabs. Put approval/rejection/cancellation in compact, purpose-specific dialogs, not one generic detail editor.
- [ ] Store active tab, filter values, and page in query parameters. Filter changes reset only the page to `1`.
- [ ] Use translations for enum labels and dates; show leave units in days while preserving the backend value for mutation payloads.
- [ ] Exercise UI with global, scoped-approver, and staff accounts.

Commit: `feat(hr-ui): add self-service and approval queues`

## Task 8: Build attendance, schedule, and people operations

**Files:**
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/pages/AttendanceDeskPage.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/pages/SchedulePage.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/pages/PeoplePage.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/AttendanceAdjustmentDialog.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/ShiftAssignmentDialog.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/CalendarOverrideDialog.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/EmployeeProfileDrawer.jsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/components/EmployeeProfileDialog.jsx`

- [ ] Attendance Desk defaults to Exceptions and makes adjustment available only through `capabilities.adjust`.
- [ ] Schedule uses readable selectors for employee, location, shift, and calendar scope. Scope-restricted configuration controls are absent when not allowed.
- [ ] People list consumes the directory projection only. The detail drawer renders sections returned by the backend; it does not attempt to reconstruct restricted data.
- [ ] Create/edit forms have labels and helper text for each business field. They submit only fields allowed for that operation.
- [ ] Apply the existing token/theme styles and responsive table overflow behavior; do not introduce nested card layouts.

Commit: `feat(hr-ui): add HR operations workbenches`

## Task 9: Verify end-to-end behavior and performance

**Files:**
- Modify: focused HR FE utility tests under `C:/Users/stack/Task/lng-web-fe/src/features/hr-time/`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/services/endpoints.contract.test.js` if HR endpoint coverage is stored there

- [ ] Backend: run the focused HR tests, then the repository HR test command; prove scope and PII regressions are covered.
- [ ] Frontend: run `node --test` for HR mapper tests, `npm run lint`, and `npm run build` in `lng-web-fe`.
- [ ] Manual: verify each route with staff, scoped approver, global HR, and admin sessions. Confirm that controls match backend capabilities and 403/409 errors surface clearly.
- [ ] Confirm search/filter changes do not trigger duplicate requests, selection is stable, and counts match the server summary.
- [ ] Confirm desktop/mobile tables keep headers aligned, only the content region scrolls, and dark mode tokens remain legible.

Suggested commands:

```powershell
cd C:\Users\stack\Task\lng-web-be
npm test -- --runInBand src/test/hr

cd C:\Users\stack\Task\lng-web-fe
npm run lint
npm run build
```

Commit: `test(hr-ui): verify time operations flows`

## Rollout Order

1. Tasks 1-4: backend correctness and response contract.
2. Task 5: revise the correct Stitch project only after the contract is real.
3. Tasks 6-8: frontend implementation in three independently reviewable slices.
4. Task 9: end-to-end verification, then request code review before merge.

