# HR API Parity UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect every business route in the POD backend HR router to a real `lng-web-fe` workflow, leaving only `GET /api/hr/health` without user-facing behavior.

**Architecture:** Preserve the existing `ENDPOINTS.HR -> TanStack Query hook -> feature page/component` flow. Add only the backend DTO capabilities required to keep business rules server-owned, then ship frontend behavior as reviewable vertical slices inside `hr-time`, `hr-payroll`, `hr-communication`, and a small read-only `hr-dashboard` feature.

**Tech Stack:** Node.js 24, Express 5, CommonJS, MongoDB/Mongoose, Joi, Jest 30, React 19, Vite 8, MUI 9, TanStack Query 5, React Hook Form, Zod, Node test runner.

## Global Constraints

- Preserve accepted legacy HR business outcomes.
- All backend HR contracts remain under `/api/hr/*`; SQL attendance remains Integration-owned under `/api/hr/integrations/*`.
- Do not add backend routes, models, repositories, or persistence semantics.
- Cross-module backend calls continue through `public.js` only.
- Frontend components never compare role names; global controls use Auth permissions and record controls use DTO capabilities.
- `GET /api/hr/health` remains headless; all other 78 routes require a runtime frontend consumer.
- Do not add a generic API console, generic HR form framework, WebSocket behavior, or a new dependency.
- Payroll, balances, refunds, bulk jobs, email delivery, and versioned adjustments never use optimistic writes or automatic mutation retry.
- HTTP 400 maps validation details to form fields; HTTP 409 preserves input and refetches server state; batch UIs display every outcome field actually returned by the backend without inventing per-row partial results.
- Use a fresh implementer and two-stage review gate for every task before starting its dependent task.
- Backend work stays on `codex/hr-api-parity-ui` in `C:\lng_system\lng-web\lng-web-be\.worktrees\hr-api-parity-ui`.
- Before Task 2, create frontend branch `codex/hr-api-parity-ui` in `C:\lng_system\lng-web\lng-web-fe\.worktrees\hr-api-parity-ui` from current `develop`, verify `.worktrees/` is ignored, run `npm install`, then run the complete frontend baseline.

---

### Task 1: Expose Server-Owned HR Action Capabilities

**Files:**
- Modify: `src/modules/hr/dtos/employeeProfile.dto.js`
- Modify: `src/modules/hr/services/employeeProfile.service.js`
- Modify: `src/modules/hr/services/leave.service.js`
- Modify: `src/modules/hr/services/payroll.service.js`
- Test: `src/test/hr/services/employeeProfile.service.test.js`
- Test: `src/test/hr/services/leave.lifecycle.test.js`
- Test: `src/test/hr/services/payroll.lifecycle.test.js`

**Interfaces:**
- Consumes: existing Auth permission arrays, scope checks, employee `isDeleted`, leave lifecycle fields, and payroll run status.
- Produces: employee `isDeleted`, `deletedAt`, and `capabilities.{edit,delete,restore}`; leave `capabilities.{attach,refund}`; payroll `capabilities.email`.

- [ ] **Step 1: Write failing employee directory capability tests**

Add a service test that lists deleted and active profiles with `includeDeleted: true` and asserts mutually exclusive capabilities:

```js
expect(result.items).toEqual(expect.arrayContaining([
  expect.objectContaining({
    id: activeId,
    isDeleted: false,
    capabilities: { edit: true, delete: true, restore: false },
  }),
  expect.objectContaining({
    id: deletedId,
    isDeleted: true,
    capabilities: { edit: false, delete: false, restore: true },
  }),
]));
```

- [ ] **Step 2: Write failing leave and payroll capability tests**

Extend persisted lifecycle tests with runtime DTO assertions:

```js
expect(pendingOwnRequest.capabilities).toMatchObject({ attach: true, refund: false });
expect(approvedAnnualRequest.capabilities).toMatchObject({ attach: false, refund: true });
expect(singleDayApprovedRequest.capabilities.refund).toBe(false);

expect(finalizedRun.capabilities).toMatchObject({ email: true });
expect(draftRun.capabilities).toMatchObject({ email: false });
expect(finalizedWithoutWrite.capabilities).toMatchObject({ email: false });
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
npx jest src/test/hr/services/employeeProfile.service.test.js src/test/hr/services/leave.lifecycle.test.js src/test/hr/services/payroll.lifecycle.test.js --runInBand
```

Expected: FAIL because the new DTO fields and capabilities are absent.

- [ ] **Step 4: Implement the minimal employee contract**

Add deletion fields to `toEmployeeProfileDirectoryDto` and centralize the existing service calculation:

```js
function profileCapabilities(profile, authContext) {
  const canWrite = canAccessProfile(authContext, profile, [hrPermissions.EMPLOYEE_WRITE]);
  const isDeleted = Boolean(profile.isDeleted);
  return {
    edit: canWrite && !isDeleted,
    delete: canWrite && !isDeleted,
    restore: canWrite && isDeleted,
  };
}
```

Use `profileCapabilities` for directory and detail DTOs. Directory DTOs return:

```js
isDeleted: Boolean(profile.isDeleted),
deletedAt: profile.deletedAt || null,
```

- [ ] **Step 5: Implement leave and payroll capabilities**

Extend `requestCapabilities` without changing transition services:

```js
const activeWorkingDates = (request.workingDateSnapshots || [])
  .filter(({ dateKey }) => !(request.refundedDateKeys || []).includes(dateKey));
return {
  view: true,
  approve: canApprove,
  reject: canApprove,
  cancel: canCancel,
  attach: request.status === hrRequestStatuses.PENDING && isRequester(request, authContext),
  refund: request.status === hrRequestStatuses.APPROVED
    && request.leaveType === hrLeaveTypes.ANNUAL
    && canApproveRequest(request, authContext)
    && activeWorkingDates.length > 1,
};
```

Extend payroll run capabilities:

```js
email: ['FINALIZED', 'PAID'].includes(run.status)
  && permissions.includes(hrPermissions.PAYROLL_WRITE),
```

- [ ] **Step 6: Verify GREEN and broad HR compatibility**

Run:

```powershell
npx jest src/test/hr/services/employeeProfile.service.test.js src/test/hr/services/leave.lifecycle.test.js src/test/hr/services/payroll.lifecycle.test.js --runInBand
npx jest src/test/hr --runInBand
npm run test:architecture -- --runInBand
```

Expected: all commands PASS.

- [ ] **Step 7: Commit backend contract changes**

```powershell
git add src/modules/hr/dtos/employeeProfile.dto.js src/modules/hr/services/employeeProfile.service.js src/modules/hr/services/leave.service.js src/modules/hr/services/payroll.service.js src/test/hr/services/employeeProfile.service.test.js src/test/hr/services/leave.lifecycle.test.js src/test/hr/services/payroll.lifecycle.test.js
git commit -m "feat(hr): expose frontend action capabilities"
```

---

### Task 2: Connect Employee Delete and Restore

**Files:**
- Modify: `src/features/hr-time/pages/PeoplePage.jsx`
- Modify: `src/features/hr-time/utils/hrTimeApi.js`
- Modify: `src/features/hr-time/hrTimeOperationsComposition.test.js`
- Create: `src/features/hr-time/components/EmployeeLifecycleDialog.jsx`

**Interfaces:**
- Consumes: Task 1 employee directory DTO and existing `useDeleteEmployeeProfileMutation` / `useRestoreEmployeeProfileMutation`.
- Produces: runtime consumers for `DELETE /employee-profiles/:profileId` and `PATCH /employee-profiles/:profileId/restore`.

- [ ] **Step 1: Create the frontend worktree and verify baseline**

From `C:\lng_system\lng-web\lng-web-fe`:

```powershell
git check-ignore -v .worktrees
git worktree add .worktrees\hr-api-parity-ui -b codex/hr-api-parity-ui develop
Set-Location .worktrees\hr-api-parity-ui
npm install
node --test "src/**/*.test.js"
```

Expected: `.worktrees/` is ignored, the branch is created from `develop`, and the complete baseline passes before edits.

- [ ] **Step 2: Write the failing composition test**

Assert that People passes `includeDeleted`, imports both mutations, and renders capability-owned actions:

```js
assert.match(page, /includeDeleted/);
assert.match(page, /useDeleteEmployeeProfileMutation/);
assert.match(page, /useRestoreEmployeeProfileMutation/);
assert.match(page, /row\.capabilities\?\.delete/);
assert.match(page, /row\.capabilities\?\.restore/);
assert.match(dialog, /Delete employee profile/);
assert.match(dialog, /Restore employee profile/);
```

- [ ] **Step 3: Run focused test and verify RED**

```powershell
node --test src/features/hr-time/hrTimeOperationsComposition.test.js
```

Expected: FAIL because runtime lifecycle controls do not exist.

- [ ] **Step 4: Map deletion fields and add the focused dialog**

Preserve server fields in `mapEmployeeProfileRow`:

```js
isDeleted: Boolean(row.isDeleted),
deletedAt: row.deletedAt || null,
capabilities: {
  ...row.capabilities,
  delete: Boolean(row.capabilities?.delete),
  restore: Boolean(row.capabilities?.restore),
},
```

`EmployeeLifecycleDialog` accepts `{ action, employee, loading, error, onClose, onConfirm }`; it displays the employee code/name, blocks close while loading, and uses destructive color only for delete.

- [ ] **Step 5: Wire People runtime behavior**

Add URL state `includeDeleted=true`; omit the query parameter when the toggle is off and send `includeDeleted: true` when it is on. Render active and deleted rows from the server-paginated response without a deleted-only client filter. Render delete/restore buttons from row capabilities, call the existing mutations, close only after success, and refetch the directory after a failure caused by stale state.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
node --test src/features/hr-time/hrTimeOperationsComposition.test.js src/features/hr-time/hrTimeOperations.test.js
npm run lint
git add src/features/hr-time
git commit -m "feat(hr): connect employee lifecycle actions"
```

Expected: focused tests and lint PASS.

---

### Task 3: Connect Payroll Preview, Run, and Email Delivery

**Files:**
- Modify: `src/features/hr-payroll/utils/hrPayrollApi.js`
- Modify: `src/features/hr-payroll/api/hrPayroll.mutations.js`
- Modify: `src/features/hr-payroll/pages/PayrollRunsPage.jsx`
- Modify: `src/features/hr-payroll/hrPayrollApi.test.js`
- Modify: `src/features/hr-payroll/hrPayrollComposition.test.js`
- Create: `src/features/hr-payroll/components/PayrollRunDialog.jsx`

**Interfaces:**
- Consumes: Task 1 `capabilities.email`, existing run/email mutations, payroll result DTO, and `HR_PAYROLL:WRITE` from Auth.
- Produces: runtime consumers for `POST /payrolls/run` and `POST /payrolls/:id/email`.

- [ ] **Step 1: Write failing adapter tests**

Add exact payload/outcome tests:

```js
assert.deepEqual(buildRunPayrollPayload({ month: '7', year: '2026', profileIds: ['p1'], shadow: true }), {
  month: 7, year: 2026, profileIds: ['p1'], shadow: true,
});
assert.deepEqual(mapPayrollEmailOutcome({ queued: 2, reused: 1, skipped: 3 }), {
  queued: 2, reused: 1, skipped: 3, jobs: [],
});
assert.equal(mapPayrollRun({ capabilities: { email: true } }).capabilities.email, true);
```

- [ ] **Step 2: Write failing composition tests and verify RED**

Assert `PayrollRunsPage` renders the run dialog, consumes `useRunPayrollMutation` and `useEmailPayrollMutation`, uses `row.capabilities?.email`, and displays all three email counters.

Run:

```powershell
node --test src/features/hr-payroll/hrPayrollApi.test.js src/features/hr-payroll/hrPayrollComposition.test.js
```

Expected: FAIL because the adapters and runtime controls are absent.

- [ ] **Step 3: Implement adapters and mutation outcomes**

Add to `hrPayrollApi.js`:

```js
export function buildRunPayrollPayload(values) {
  return {
    month: Number(values.month),
    year: Number(values.year),
    profileIds: values.profileIds || [],
    shadow: Boolean(values.shadow),
  };
}

export function mapPayrollEmailOutcome(payload = {}) {
  return {
    queued: payload.queued || 0,
    reused: payload.reused || 0,
    skipped: payload.skipped || 0,
    jobs: payload.jobs || [],
  };
}
```

Map `capabilities.email` and return mapped email outcomes from `useEmailPayrollMutation`.

- [ ] **Step 4: Implement the payroll dialog and page flow**

`PayrollRunDialog` uses month, year, optional profile multi-select, and two explicit actions. “Preview” submits `shadow: true` and renders returned results without closing. “Run and persist” requires a second confirmation and submits `shadow: false`. It disables all controls while pending.

Add an email action only for `row.capabilities?.email`. Reuse `PayrollActionDialog` for confirmation, then render `queued`, `reused`, and `skipped` in its outcome area.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
node --test src/features/hr-payroll/hrPayrollApi.test.js src/features/hr-payroll/hrPayrollComposition.test.js
npm run lint
git add src/features/hr-payroll
git commit -m "feat(hr): connect payroll execution and email"
```

---

### Task 4: Add Payroll Adjustment Administration

**Files:**
- Modify: `src/services/endpoints.js`
- Modify: `src/services/endpoints.contract.test.js`
- Modify: `src/features/hr-payroll/api/hrPayroll.queries.js`
- Modify: `src/features/hr-payroll/api/hrPayroll.mutations.js`
- Modify: `src/features/hr-payroll/pages/PayrollRunsPage.jsx`
- Modify: `src/features/hr-payroll/hrPayrollApi.test.js`
- Modify: `src/features/hr-payroll/hrPayrollComposition.test.js`
- Create: `src/features/hr-payroll/components/PayrollAdjustmentsPanel.jsx`
- Create: `src/features/hr-payroll/components/PayrollAdjustmentDialog.jsx`

**Interfaces:**
- Consumes: payroll adjustment DTO and employee directory query.
- Produces: runtime consumers for all four `/payroll-adjustments` routes and query keys `hrPayrollKeys.adjustments(query)`.

- [ ] **Step 1: Write failing endpoint and adapter tests**

Add endpoint contracts:

```js
assert.equal(ENDPOINTS.HR.PAYROLL_ADJUSTMENTS, '/api/hr/payroll-adjustments');
assert.equal(ENDPOINTS.HR.PAYROLL_ADJUSTMENT('a1'), '/api/hr/payroll-adjustments/a1');
```

Assert the adjustment mapper preserves integer `amount`, `version`, `requiresReview`, and `draftPayrollRefreshed`, and the form builder includes `expectedVersion` only for updates.

- [ ] **Step 2: Write failing composition tests and verify RED**

Require filters for `profileId`, month, year, status, and type; create/edit/cancel controls; `expectedVersion`; `retry: false`; and visible review/refresh outcomes.

Run:

```powershell
node --test src/services/endpoints.contract.test.js src/features/hr-payroll/hrPayrollApi.test.js src/features/hr-payroll/hrPayrollComposition.test.js
```

Expected: FAIL because adjustment endpoints and components are absent.

- [ ] **Step 3: Add query and mutations**

Add endpoint constants and query key:

```js
adjustments: (query) => [...hrPayrollKeys.all, 'adjustments', query],
```

Add `usePayrollAdjustmentsQuery`, `useCreatePayrollAdjustmentMutation`, `useUpdatePayrollAdjustmentMutation`, and `useCancelPayrollAdjustmentMutation`. Update and cancel send the loaded row version. All mutations set `retry: false` and invalidate adjustment keys plus payroll run keys only when `draftPayrollRefreshed` is true.

- [ ] **Step 4: Build the panel and versioned dialog**

`PayrollAdjustmentsPanel` owns URL filters and pagination. `PayrollAdjustmentDialog` uses employee, period, type, code, name, integer VND amount, and note. Cancel uses a destructive confirmation dialog, not a hard delete label.

On HTTP 409, keep values open, refetch the list, and show: `This adjustment changed on the server. Review the refreshed row before retrying.`

- [ ] **Step 5: Verify GREEN and commit**

```powershell
node --test src/services/endpoints.contract.test.js src/features/hr-payroll/hrPayrollApi.test.js src/features/hr-payroll/hrPayrollComposition.test.js
npm run lint
git add src/services/endpoints.js src/services/endpoints.contract.test.js src/features/hr-payroll
git commit -m "feat(hr): add payroll adjustment administration"
```

---

### Task 5: Complete Leave Preview, Attachments, and Refunds

**Files:**
- Modify: `src/services/endpoints.js`
- Modify: `src/services/endpoints.contract.test.js`
- Modify: `src/features/hr-time/api/hrTime.mutations.js`
- Modify: `src/features/hr-time/pages/MyTimePage.jsx`
- Modify: `src/features/hr-time/pages/RequestInboxPage.jsx`
- Modify: `src/features/hr-time/components/RequestReviewDrawer.jsx`
- Modify: `src/features/hr-time/hrTimeWorkflowComposition.test.js`
- Modify: `src/features/hr-time/utils/hrTimeApi.test.js`
- Create: `src/features/hr-time/components/LeaveRequestPreviewDialog.jsx`
- Create: `src/features/hr-time/components/LeaveAttachmentDialog.jsx`
- Create: `src/features/hr-time/components/LeaveRefundDialog.jsx`

**Interfaces:**
- Consumes: Task 1 leave capabilities, Media asset upload endpoint, and existing leave request mapper.
- Produces: runtime consumers for leave preview, attachments, and refund routes.

- [ ] **Step 1: Write failing endpoint and payload tests**

Add:

```js
LEAVE_REQUEST_PREVIEW: '/api/hr/leave-requests/preview',
LEAVE_REQUEST_ATTACHMENTS: (id) => `/api/hr/leave-requests/${id}/attachments`,
LEAVE_REQUEST_REFUND: (id) => `/api/hr/leave-requests/${id}/refund`,
```

Test that preview reuses the exact create payload, attachment payloads contain only `{ mediaId, filename, mimeType }`, and refund payloads contain unique date keys plus a trimmed reason.

- [ ] **Step 2: Write failing workflow composition tests and verify RED**

Assert preview occurs before create, upload uses `FormData` and `ENDPOINTS.MEDIA.ASSETS`, drawer actions use `capabilities.attach` / `capabilities.refund`, and refund requires at least one remaining working date.

Run:

```powershell
node --test src/services/endpoints.contract.test.js src/features/hr-time/utils/hrTimeApi.test.js src/features/hr-time/hrTimeWorkflowComposition.test.js
```

Expected: FAIL because the three workflows are absent.

- [ ] **Step 3: Add mutations with no retry**

Implement:

```js
usePreviewLeaveRequestMutation()
useUploadLeaveAttachmentMutation()
useAttachLeaveReferencesMutation()
useRefundLeaveRequestMutation()
```

The upload mutation posts one file as `FormData` to `ENDPOINTS.MEDIA.ASSETS`; the attach mutation sends only the returned media reference. Success invalidates leave list/detail keys and balance keys for refunds.

- [ ] **Step 4: Wire preview-confirm and request actions**

`MyTimePage` stores the draft payload, previews it, opens `LeaveRequestPreviewDialog`, and creates only after explicit confirmation. The preview shows requested units, working-date snapshots, available balance, overlaps, and `isPossible`.

The requester drawer opens `LeaveAttachmentDialog` only when `capabilities.attach`. The approver drawer opens `LeaveRefundDialog` only when `capabilities.refund`; refunded dates are excluded and the dialog prevents selecting every remaining date.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
node --test src/services/endpoints.contract.test.js src/features/hr-time/utils/hrTimeApi.test.js src/features/hr-time/hrTimeWorkflowComposition.test.js
npm run lint
git add src/services/endpoints.js src/services/endpoints.contract.test.js src/features/hr-time
git commit -m "feat(hr): complete leave request workflows"
```

---

### Task 6: Add Leave Balance Administration

**Files:**
- Modify: `src/services/endpoints.js`
- Modify: `src/services/endpoints.contract.test.js`
- Modify: `src/features/hr-time/api/hrTime.queries.js`
- Modify: `src/features/hr-time/api/hrTime.mutations.js`
- Modify: `src/features/hr-time/components/EmployeeProfileDrawer.jsx`
- Modify: `src/features/hr-time/pages/PeoplePage.jsx`
- Modify: `src/features/hr-time/hrTimeOperationsComposition.test.js`
- Create: `src/features/hr-time/components/LeaveBalancePanel.jsx`
- Create: `src/features/hr-time/components/LeaveBalanceAdminDialog.jsx`

**Interfaces:**
- Consumes: existing `useLeaveBalanceQuery`, employee profile ID, and `HR_LEAVE:APPROVE`.
- Produces: runtime consumers for balance read/upsert/adjust/accrue/reset/carry-over routes.

- [ ] **Step 1: Write failing endpoint and composition tests**

Add and assert exact endpoint functions/constants:

```js
LEAVE_BALANCE_ADJUST: (profileId, year, leaveType) =>
  `/api/hr/leave-balances/${profileId}/${year}/${leaveType}/adjust`,
LEAVE_BALANCE_ACCRUE: '/api/hr/leave-balances/accrue',
LEAVE_BALANCE_RESET: '/api/hr/leave-balances/reset',
LEAVE_BALANCE_CARRY_OVER: '/api/hr/leave-balances/carry-over',
```

Assert the drawer consumes `useLeaveBalanceQuery`, renders history, and gates all writes with `HR_LEAVE:APPROVE` rather than a role name.

Assert each batch dialog renders the backend's `processed`, optional `changed`, and returned item evidence and uses explicit confirmation. Assert a rejected request renders one request-level error instead of fabricated row failures.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test src/services/endpoints.contract.test.js src/features/hr-time/hrTimeOperationsComposition.test.js
```

Expected: FAIL because endpoints and administration components are absent.

- [ ] **Step 3: Add balance mutations**

Implement hooks for:

```js
useUpsertLeaveBalanceMutation()
useAdjustLeaveBalanceMutation()
useAccrueLeaveBalancesMutation()
useResetLeaveBalancesMutation()
useCarryOverLeaveBalancesMutation()
```

All use `retry: false`. Individual writes invalidate the selected balance and employee balance prefix. Batch jobs invalidate all leave-balance keys.

- [ ] **Step 4: Build individual and batch administration**

`LeaveBalancePanel` selects year/type and displays entitled, carried-over, adjustment, used, available, last accrued month, and history. Upsert requires entitled units, adjustment units, and reason. Adjust requires a non-zero signed unit value and reason.

`LeaveBalanceAdminDialog` has modes `accrue`, `reset`, and `carryOver`, exact fields from the backend validators, optional employee selection, preview text, and a result summary that remains visible until closed. Accrual displays `processed`, `changed`, and returned items; reset/carry-over display `processed` and returned items. Request rejection displays the normalized API error.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
node --test src/services/endpoints.contract.test.js src/features/hr-time/hrTimeOperationsComposition.test.js
npm run lint
git add src/services/endpoints.js src/services/endpoints.contract.test.js src/features/hr-time
git commit -m "feat(hr): add leave balance administration"
```

---

### Task 7: Complete Holiday and Saturday Rotation Administration

**Files:**
- Modify: `src/services/endpoints.js`
- Modify: `src/services/endpoints.contract.test.js`
- Modify: `src/features/hr-time/api/hrTime.queries.js`
- Modify: `src/features/hr-time/api/hrTime.mutations.js`
- Modify: `src/features/hr-time/api/hrTime.keys.js`
- Modify: `src/features/hr-time/pages/SchedulePage.jsx`
- Modify: `src/features/hr-time/hrTimeOperationsComposition.test.js`
- Create: `src/features/hr-time/components/HolidayDetailDrawer.jsx`
- Create: `src/features/hr-time/components/HolidayBulkImportDialog.jsx`
- Create: `src/features/hr-time/components/HolidayPolicySummary.jsx`
- Create: `src/features/hr-time/components/RotationMaintenanceDialog.jsx`

**Interfaces:**
- Consumes: holiday and rotation DTOs, directory teams/profiles, and existing Schedule tabs.
- Produces: runtime consumers for holiday templates/range/check/summary/detail/bulk-import and rotation update/team-delete routes.

- [ ] **Step 1: Write failing endpoint contract tests**

Add and assert exact paths:

```js
HOLIDAY_TEMPLATES: '/api/hr/holidays/templates',
HOLIDAY_RANGE: '/api/hr/holidays/range',
HOLIDAY_CHECK: '/api/hr/holidays/check',
HOLIDAY_SUMMARY: (year) => `/api/hr/holidays/summary/${year}`,
HOLIDAY_BULK_IMPORT: '/api/hr/holidays/bulk-import',
SATURDAY_ROTATION_TEAM: (teamId) => `/api/hr/saturday-rotations/team/${teamId}`,
```

Reuse `HOLIDAY(id)` for detail and `SATURDAY_ROTATION(id)` for update.

- [ ] **Step 2: Write failing composition tests and verify RED**

Assert Schedule consumes every query/mutation, bulk import caps rows at 100, policy check is used before calendar write, rotation update sends `employeeProfileIds`, and team delete sends month/year as query params.

Run:

```powershell
node --test src/services/endpoints.contract.test.js src/features/hr-time/hrTimeOperationsComposition.test.js
```

Expected: FAIL because the missing calendar behaviors are absent.

- [ ] **Step 3: Add query keys, reads, and mutations**

Add keys for holiday detail, templates, range, check, summary, and rotations. Add enabled guards for required IDs/dates. Add bulk import, update rotation, and delete-team-rotations mutations with `retry: false` and targeted invalidation.

- [ ] **Step 4: Build focused calendar components**

`HolidayDetailDrawer` loads by ID. `HolidayPolicySummary` shows year totals and range rows, and invokes check for the date/scope selected in the editor. `HolidayBulkImportDialog` validates one to 100 rows before submission and renders row-level failures. `RotationMaintenanceDialog` edits employee IDs or deletes the selected team/month/year after confirmation.

Keep orchestration in `SchedulePage`; do not move existing unrelated schedule behavior.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
node --test src/services/endpoints.contract.test.js src/features/hr-time/hrTimeOperationsComposition.test.js
npm run lint
git add src/services/endpoints.js src/services/endpoints.contract.test.js src/features/hr-time
git commit -m "feat(hr): complete calendar policy administration"
```

---

### Task 8: Add HR Dashboard and Announcement Detail

**Files:**
- Modify: `src/services/endpoints.js`
- Modify: `src/services/endpoints.contract.test.js`
- Modify: `src/constants/routes.js`
- Modify: `src/layouts/sidebarNavigation.js`
- Modify: `src/routes/index.jsx`
- Modify: `src/features/hr-communication/pages/AnnouncementsPage.jsx`
- Modify: `src/features/hr-communication/announcementComposition.test.js`
- Create: `src/features/hr-dashboard/api/hrDashboard.queries.js`
- Create: `src/features/hr-dashboard/pages/HrDashboardPage.jsx`
- Create: `src/features/hr-dashboard/hrDashboardComposition.test.js`
- Create: `src/features/hr-communication/components/AnnouncementDetailDrawer.jsx`

**Interfaces:**
- Consumes: `GET /api/hr/dashboard`, `GET /api/hr/announcements/:id`, `HR_EMPLOYEES:READ`, and existing announcement mapper.
- Produces: runtime consumers for dashboard and announcement detail routes plus `/hr/dashboard` navigation.

- [ ] **Step 1: Write failing endpoint, route, and composition tests**

Add:

```js
DASHBOARD: '/api/hr/dashboard',
```

Assert `/hr/dashboard` is lazy-mounted, sidebar visibility requires `HR_EMPLOYEES:READ`, dashboard query forwards `dateKey`, and cards render employee, attendance, and approval DTO sections.

Assert clicking an announcement row opens a drawer whose query uses `ENDPOINTS.HR.ANNOUNCEMENT(id)`.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test src/services/endpoints.contract.test.js src/layouts/sidebarNavigation.test.js src/features/hr-dashboard/hrDashboardComposition.test.js src/features/hr-communication/announcementComposition.test.js
```

Expected: FAIL because dashboard files and announcement detail behavior are absent.

- [ ] **Step 3: Implement the read-only dashboard**

Use one query:

```js
export function useHrDashboardQuery(dateKey) {
  return useQuery({
    queryKey: ['hr-dashboard', dateKey],
    queryFn: () => apiClient.get(ENDPOINTS.HR.DASHBOARD, { params: { dateKey } }).then(unwrap),
  });
}
```

The page uses existing operations primitives and displays the exact DTO values: employee status counts, expected/record/present/late/absent/on-leave/missing-checkout attendance counts, coverage rate, and approval counts.

- [ ] **Step 4: Add announcement detail behavior**

Add selected-ID state and an enabled detail query. `AnnouncementDetailDrawer` renders content, targeting, attachments, schedule/publish/reminder timestamps, event details, and capability-owned edit/delete handoffs to the existing dialogs.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
node --test src/services/endpoints.contract.test.js src/layouts/sidebarNavigation.test.js src/features/hr-dashboard/hrDashboardComposition.test.js src/features/hr-communication/announcementComposition.test.js
npm run lint
git add src/services/endpoints.js src/services/endpoints.contract.test.js src/constants/routes.js src/layouts/sidebarNavigation.js src/routes/index.jsx src/features/hr-dashboard src/features/hr-communication
git commit -m "feat(hr): add dashboard and announcement detail"
```

---

### Task 9: Enforce HR Runtime Coverage and Run Completion Gates

**Files:**
- Create: `src/features/hr/hrApiCoverage.test.js`
- Create: `docs/hr/hr-api-frontend-coverage.md`
- Modify only if the audit finds a real gap: owning HR feature file and its focused test.

**Interfaces:**
- Consumes: all Task 1-8 contracts and runtime source files.
- Produces: executable coverage proof for 78 business routes and a human-readable 79-route report.

- [ ] **Step 1: Write the failing coverage test**

Create a Node test with an explicit array of the 79 `{ method, path, disposition, sourceFiles }` contracts. The only `disposition: 'headless'` row is `GET /api/hr/health`; every other row has at least one runtime page/component source file.

The test reads each listed source and asserts the matching endpoint constant or hook name exists. It separately scans exported HR hooks and asserts each is referenced outside its defining file and tests.

Key assertion:

```js
assert.equal(routes.length, 79);
assert.equal(routes.filter(({ disposition }) => disposition === 'runtime').length, 78);
assert.deepEqual(
  routes.filter(({ disposition }) => disposition === 'headless').map(({ method, path }) => `${method} ${path}`),
  ['GET /api/hr/health'],
);
assert.deepEqual(unusedHooks, []);
```

- [ ] **Step 2: Run coverage test and verify RED**

```powershell
node --test src/features/hr/hrApiCoverage.test.js
```

Expected: FAIL on any missing route evidence or declaration-only hook.

- [ ] **Step 3: Close only evidence-backed gaps and write the report**

For every failure, connect the hook to its owning page or remove a genuinely redundant wrapper. Do not weaken the expected route list.

Write `docs/hr/hr-api-frontend-coverage.md` with columns Method, Route, Owner page/component, Hook/API adapter, and Status. Include all 79 routes and mark only health as `headless`.

- [ ] **Step 4: Run complete backend and frontend verification**

Backend worktree:

```powershell
npx jest src/test/hr --runInBand
npm run test:architecture -- --runInBand
```

Frontend worktree:

```powershell
node --test "src/**/*.test.js"
npm run lint
npm run build
```

Expected: every command PASS. The build may retain the existing chunk-size warning, but must exit 0.

- [ ] **Step 5: Verify both repository diffs and commit coverage evidence**

```powershell
git diff --check
git status --short --branch
git add src/features/hr/hrApiCoverage.test.js docs/hr/hr-api-frontend-coverage.md
git commit -m "test(hr): enforce frontend API coverage"
```

Confirm the backend and frontend worktrees contain only task commits, no `.env`, generated `dist`, credentials, or unrelated user changes.

## Program Completion Check

- Backend contract commit and all frontend slice commits exist on their respective `codex/hr-api-parity-ui` branches.
- The backend reports 48/48 or more HR suites passing and architecture tests pass.
- The frontend full test suite, lint, and production build pass.
- Coverage reports 78 runtime routes, one headless health route, and zero declaration-only HR hooks.
- Each task has passed specification review and code-quality review before the next task starts.
