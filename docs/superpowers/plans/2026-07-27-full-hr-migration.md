# Full HR Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone `lng-hr-be` service with parity-tested HR capabilities in the POD backend and `lng-web-fe`, then retire the old service after a verified payroll shadow period.

**Architecture:** Extend the existing POD `hr` module, add a shared `notification` module, and add SQL attendance ingestion below `integration`. Reuse POD Auth, Organization, Audit, MongoDB, API client, shell, and RBAC; migrate data with idempotent dry-run-first scripts and release dependent slices sequentially.

**Tech Stack:** Node.js 24.13.0 in the current workspace, Express 5, CommonJS, MongoDB/Mongoose, Redis/BullMQ, Joi, Jest 30, React 19, MUI 9, TanStack Query 5, React Hook Form, Zod, Vite 8.

## Global Constraints

- Preserve accepted standalone HR business outcomes before changing behavior.
- All backend HTTP contracts use `/api/hr/*`, except shared inbox APIs at `/api/notifications`.
- Cross-module calls use the target module's `public.js`; controllers and services never import another module's models or repositories.
- Controllers parse HTTP only, services own business rules, repositories own Mongoose access, and DTOs shape responses.
- Read-only Mongoose queries use `.lean()`.
- POD Auth/RBAC and Organization are the only account, permission, department, team, and membership sources of truth.
- SQL Server remains the source of raw clock punches; POD MongoDB is the HR business source of truth.
- Migration commands default to dry-run, are idempotent, and never delete source data.
- Payroll finalize and mark-paid are never automatically retried.
- Notification failures never roll back a committed HR transition; retries use stable deduplication keys.
- Do not add Socket.IO during migration; poll `/api/notifications` with TanStack Query.
- Before implementation, use `superpowers:using-git-worktrees` to create isolated backend and frontend worktrees because `lng-web-fe` may contain unrelated user changes.
- Execute tasks in order. A dependent task starts only after the preceding task's focused tests and reviewer gate pass.

---

### Task 1: Freeze the legacy parity contract

**Files:**
- Create: `src/modules/hr/scripts/legacyParityCatalog.js`
- Create: `src/test/hr/scripts/legacyParityCatalog.test.js`
- Create: `src/test/hr/fixtures/legacyAttendanceResolution.cases.js`
- Create: `docs/hr/legacy-parity-matrix.md`
- Reference only: `C:\lng_system\lng-hr\lng-hr-be\server.js`
- Reference only: `C:\lng_system\lng-hr\lng-hr-be\tests\attendance-resolution.logic.test.js`
- Reference only: `C:\lng_system\lng-hr\lng-hr-be\src\domain\hr\payroll.logic.js`

**Interfaces:**
- Produces: `legacyParityCatalog: Array<{ id, sourceRoutes, sourceJobs, targetOwner, disposition, evidence }>`.
- Produces: `assertLegacyParityCatalog(catalog) -> { ready, missingEvidenceIds, duplicateIds }`.
- Produces: `legacyAttendanceResolutionCases: Array<{ name, input, expected }>`.
- Consumes: no production interfaces.

- [ ] **Step 1: Write the failing catalog test**

```js
const { assertLegacyParityCatalog } = require('../../../modules/hr/scripts/legacyParityCatalog');

test('readiness audit blocks migration when a legacy domain lacks parity evidence', () => {
  expect(assertLegacyParityCatalog([
    { id: 'attendance', disposition: 'replace', evidence: ['resolver cases'] },
    { id: 'payroll', disposition: 'replace', evidence: [] },
    { id: 'payroll', disposition: 'replace', evidence: ['shadow diff'] },
  ])).toEqual({
    ready: false,
    missingEvidenceIds: ['payroll'],
    duplicateIds: ['payroll'],
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx jest src/test/hr/scripts/legacyParityCatalog.test.js --runInBand`

Expected: FAIL because `legacyParityCatalog.js` does not exist.

- [ ] **Step 3: Add the explicit catalog and attendance fixtures**

```js
const legacyParityCatalog = [
  { id: 'employees', sourceRoutes: ['/api/employees'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['employee route contract', 'migration counts'] },
  { id: 'shifts', sourceRoutes: ['/api/shifts'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['shift route contract'] },
  { id: 'holidays', sourceRoutes: ['/api/holidays'], sourceJobs: ['holiday attendance repair'], targetOwner: 'hr', disposition: 'replace', evidence: ['holiday precedence cases'] },
  { id: 'saturday-rotations', sourceRoutes: ['/api/saturday-rotations'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['rotation schedule cases'] },
  { id: 'attendance', sourceRoutes: ['/api/attendances'], sourceJobs: ['reconciliation'], targetOwner: 'hr', disposition: 'replace', evidence: ['legacyAttendanceResolutionCases'] },
  { id: 'sql-attendance-worker', sourceRoutes: ['/api/sql-server'], sourceJobs: ['sql-attendance-worker'], targetOwner: 'integration', disposition: 'replace', evidence: ['cursor and idempotency tests'] },
  { id: 'leaves', sourceRoutes: ['/api/leaves'], sourceJobs: ['leave attendance sync'], targetOwner: 'hr', disposition: 'replace', evidence: ['leave lifecycle cases'] },
  { id: 'leave-balances', sourceRoutes: ['/api/leave-balances'], sourceJobs: ['accrual', 'reset', 'carry-over'], targetOwner: 'hr', disposition: 'replace', evidence: ['balance lifecycle cases'] },
  { id: 'overtime', sourceRoutes: ['/api/overtimes'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['overtime lifecycle cases'] },
  { id: 'payroll', sourceRoutes: ['/api/payrolls'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['per-employee shadow diff'] },
  { id: 'payroll-adjustments', sourceRoutes: ['/api/payroll-adjustments'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['adjustment lifecycle cases'] },
  { id: 'payroll-email', sourceRoutes: [], sourceJobs: ['payroll email worker'], targetOwner: 'hr', disposition: 'replace', evidence: ['deduplicated email job tests'] },
  { id: 'notifications', sourceRoutes: ['/api/notifications'], sourceJobs: [], targetOwner: 'notification', disposition: 'replace', evidence: ['inbox and retry tests'] },
  { id: 'announcements', sourceRoutes: ['/api/announcements'], sourceJobs: ['announcement publish and reminder'], targetOwner: 'hr', disposition: 'replace', evidence: ['visibility and recipient tests'] },
  { id: 'dashboard', sourceRoutes: ['/api/dashboard'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['DTO aggregate tests'] },
  { id: 'office-networks', sourceRoutes: ['/api/office-networks'], sourceJobs: [], targetOwner: 'integration', disposition: 'replace', evidence: ['trusted network validation tests'] },
  { id: 'system-settings', sourceRoutes: ['/api/system-settings'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['explicit setting mapping'] },
];

function assertLegacyParityCatalog(catalog = legacyParityCatalog) {
  const ids = catalog.map(({ id }) => id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const missingEvidenceIds = catalog
    .filter((entry) => !entry.disposition || !entry.evidence?.length)
    .map(({ id }) => id);
  return { ready: !duplicateIds.length && !missingEvidenceIds.length, missingEvidenceIds, duplicateIds };
}

module.exports = { legacyParityCatalog, assertLegacyParityCatalog };
```

Copy the ten accepted resolver inputs and expected outputs from the legacy
`attendance-resolution.logic.test.js` into the fixture file as plain objects;
remove database identifiers and names while preserving statuses, workday
values, leave types, swipe times, and precedence.

- [ ] **Step 4: Document route/job disposition and run checks**

Write `docs/hr/legacy-parity-matrix.md` from the catalog with columns `ID`,
`Legacy entrypoint`, `Target owner`, `Evidence`, and `Gate`. Every row uses
`Gate: required before cutover`; none are marked optional.

Run: `npx jest src/test/hr/scripts/legacyParityCatalog.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit the parity contract**

```powershell
git add src/modules/hr/scripts/legacyParityCatalog.js src/test/hr/scripts/legacyParityCatalog.test.js src/test/hr/fixtures/legacyAttendanceResolution.cases.js docs/hr/legacy-parity-matrix.md
git commit -m "test(hr): freeze legacy parity contract"
```

---

### Task 2: Complete HR calendar and permission foundations

**Files:**
- Create: `src/modules/hr/models/holiday.model.js`
- Create: `src/modules/hr/models/saturdayRotation.model.js`
- Create: `src/modules/hr/repositories/calendarPolicy.repository.js`
- Create: `src/modules/hr/services/calendarPolicy.service.js`
- Create: `src/modules/hr/controllers/calendarPolicy.controller.js`
- Create: `src/modules/hr/validators/calendarPolicy.validator.js`
- Create: `src/modules/hr/dtos/calendarPolicy.dto.js`
- Modify: `src/modules/hr/routes/index.js`
- Modify: `src/modules/hr/constants/hr.constants.js`
- Modify: `src/modules/auth/scripts/seedRbac.js`
- Test: `src/test/hr/services/calendarPolicy.service.test.js`
- Test: `src/test/hr/routes/calendarPolicy.routes.test.js`
- Test: `src/test/auth/scripts/seedRbac.test.js`

**Interfaces:**
- Produces: `resolveCalendarPolicy({ profileId, workDateKey }) -> { isSunday, isRotationOff, holiday, scheduleSnapshot }`.
- Produces: `/api/hr/holidays` and `/api/hr/saturday-rotations` CRUD contracts.
- Produces permissions: `HR_CALENDAR:READ`, `HR_CALENDAR:WRITE`, `HR_PAYROLL:READ`, `HR_PAYROLL:WRITE`, `HR_PAYROLL:FINALIZE`, `HR_PAYROLL:PAY`, `HR_ANNOUNCEMENTS:READ`, `HR_ANNOUNCEMENTS:WRITE`, `HR_INTEGRATIONS:MANAGE`.
- Consumes: existing employee profiles, schedule resolver, Auth public authorization, and Organization identifiers.

- [ ] **Step 1: Write failing calendar precedence and RBAC tests**

```js
test('paid applicable holiday wins over Sunday and rotation-off', async () => {
  holidayRepository.findApplicable.mockResolvedValue({ type: 'PUBLIC_HOLIDAY', isPaid: true });
  rotationRepository.isOffDay.mockResolvedValue(true);
  await expect(service.resolveCalendarPolicy({ profileId: 'p1', workDateKey: '2026-09-06' }))
    .resolves.toMatchObject({ isSunday: true, isRotationOff: true, holiday: { isPaid: true } });
});
```

Extend `seedRbac.test.js` to run `seedRbac()` against its controlled repository
double and assert the resulting persisted permission rows include every code in
the Interfaces block exactly once.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx jest src/test/hr/services/calendarPolicy.service.test.js src/test/hr/routes/calendarPolicy.routes.test.js src/test/auth/scripts/seedRbac.test.js --runInBand`

Expected: FAIL because calendar policy files and new permissions are absent.

- [ ] **Step 3: Implement models, repository, service, DTO, validator, and routes**

Use stable uniqueness rules:

```js
holidaySchema.index({ dateKey: 1, organizationScopeKey: 1 }, { unique: true });
saturdayRotationSchema.index({ profileId: 1, workDateKey: 1 }, { unique: true });
```

The repository exposes `findApplicable`, `listHolidays`, `upsertHoliday`,
`isRotationOff`, and `upsertRotation`; every read returns lean objects. The
service calls the existing schedule resolver and returns a DTO without raw
Mongoose documents.

- [ ] **Step 4: Run HR, Auth, and architecture tests**

Run: `npx jest src/test/hr src/test/auth/scripts/seedRbac.test.js src/test/architecture.contract.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit calendar foundations**

```powershell
git add src/modules/hr src/modules/auth/scripts/seedRbac.js src/test/hr src/test/auth/scripts/seedRbac.test.js
git commit -m "feat(hr): add calendar policy foundations"
```

---

### Task 3: Add the shared Notification module

**Files:**
- Create: `src/modules/notification/index.js`
- Create: `src/modules/notification/public.js`
- Create: `src/modules/notification/models/notification.model.js`
- Create: `src/modules/notification/repositories/notification.repository.js`
- Create: `src/modules/notification/services/notification.service.js`
- Create: `src/modules/notification/controllers/notification.controller.js`
- Create: `src/modules/notification/validators/notification.validator.js`
- Create: `src/modules/notification/dtos/notification.dto.js`
- Create: `src/modules/notification/routes/index.js`
- Modify: `src/modules/index.js`
- Test: `src/test/notification/services/notification.service.test.js`
- Test: `src/test/notification/routes/index.test.js`
- Test: `src/test/notification/public.contract.test.js`

**Interfaces:**
- Produces: `notificationPublic.notify({ recipientAccountId, type, title, message, relatedResource, deduplicationKey })`.
- Produces: `notificationPublic.notifyMany({ recipientAccountIds, type, title, message, relatedResource, deduplicationKeyPrefix })`.
- Produces: `GET /api/notifications`, `GET /api/notifications/unread-count`, `PATCH /api/notifications/read-all`, and `PATCH /api/notifications/:id/read`.
- Consumes: Auth account identifiers and `auth.public.authenticate` only.

- [ ] **Step 1: Write failing idempotency and ownership tests**

```js
test('replay returns the existing inbox item', async () => {
  repository.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
  repository.findByDeduplicationKey.mockResolvedValue({ _id: 'n1', recipientAccountId: 'a1' });
  await expect(service.notify({
    recipientAccountId: 'a1', type: 'LEAVE_APPROVED', title: 'Leave approved',
    message: 'Your leave was approved', relatedResource: { type: 'leaveRequest', id: 'l1' },
    deduplicationKey: 'leave:l1:approved:a1',
  })).resolves.toMatchObject({ id: 'n1' });
});
```

Add a route test proving account `a1` cannot mark account `a2`'s notification
as read.

- [ ] **Step 2: Run notification tests and verify failure**

Run: `npx jest src/test/notification --runInBand`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal persisted inbox**

Use one unique index and no Socket.IO:

```js
notificationSchema.index(
  { recipientAccountId: 1, deduplicationKey: 1 },
  { unique: true },
);
notificationSchema.index({ recipientAccountId: 1, readAt: 1, createdAt: -1 });
```

The public port catches persistence errors and returns
`{ delivered: false, errorCode, correlationId }`; it does not throw into the
originating domain. Successful creation returns `{ delivered: true, id }`.

- [ ] **Step 4: Mount and verify the module**

Run: `node -c src/modules/notification/public.js`

Run: `npx jest src/test/notification src/test/architecture.contract.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit Notification**

```powershell
git add src/modules/index.js src/modules/notification src/test/notification
git commit -m "feat(notification): add shared persisted inbox"
```

---

### Task 4: Port attendance resolution and SQL ingestion

**Files:**
- Create: `src/modules/hr/services/attendanceResolution.service.js`
- Modify: `src/modules/hr/services/attendance.service.js`
- Modify: `src/modules/hr/public.js`
- Create: `src/modules/integration/sqlAttendance/models/sqlAttendanceSync.model.js`
- Create: `src/modules/integration/sqlAttendance/repositories/sqlAttendanceSync.repository.js`
- Create: `src/modules/integration/sqlAttendance/services/sqlAttendanceClient.service.js`
- Create: `src/modules/integration/sqlAttendance/services/sqlAttendanceImport.service.js`
- Create: `src/modules/integration/sqlAttendance/workers/sqlAttendance.worker.js`
- Create: `src/modules/integration/sqlAttendance/public.js`
- Create: `src/modules/integration/sqlAttendance/routes/index.js`
- Modify: `src/modules/integration/index.js`
- Modify: `src/modules/integration/public.js`
- Modify: `src/modules/index.js`
- Modify: `package.json`
- Test: `src/test/hr/services/attendanceResolution.service.test.js`
- Test: `src/test/integration/sqlAttendance/sqlAttendanceImport.service.test.js`
- Test: `src/test/integration/sqlAttendance/sqlAttendance.worker.test.js`

**Interfaces:**
- Produces: `hrPublic.importAttendancePunches({ sourceBatchId, punches }) -> { inserted, updated, unchanged, failed }`.
- Produces: `resolveAttendanceDay(input) -> { status, workDayValue, leaveRequestId, calculationReason, swipeCalculation }`.
- Produces: `POST /api/hr/integrations/sql-attendance/sync` and `GET /api/hr/integrations/sql-attendance/status`, guarded by `HR_INTEGRATIONS:MANAGE`.
- Consumes: `resolveCalendarPolicy`, existing HR schedule/profile repositories, and environment keys `DB_SERVER`, `DB_DATABASE`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`.

- [ ] **Step 1: Write failing resolver and duplicate-batch tests**

Feed every object from `legacyAttendanceResolutionCases` into
`resolveAttendanceDay` and assert deep equality. Add a SQL import test that
invokes the same `sourceBatchId` twice and expects the second result to be
`{ inserted: 0, updated: 0, unchanged: 2, failed: 0 }`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx jest src/test/hr/services/attendanceResolution.service.test.js src/test/integration/sqlAttendance --runInBand`

Expected: FAIL because resolver and SQL ingestion files are absent.

- [ ] **Step 3: Port the pure resolver, then wire every writer through it**

Port the accepted legacy precedence into one pure function in this exact order:

```text
manual edit -> applicable paid holiday -> Sunday/rotation off -> approved leave -> swipe/absence
```

Overtime fields never change `workDayValue`. Excel/manual import, leave
approval/reversal, holiday repair, SQL ingestion, and reconciliation call the
same resolver through HR service methods.

- [ ] **Step 4: Implement the SQL worker with a persisted watermark**

The worker fetches a bounded page after `lastSourceTimestamp`, normalizes rows,
calls `hrPublic.importAttendancePunches`, and advances the watermark only after
the whole page succeeds. Add `"worker:sql-attendance": "node src/modules/integration/sqlAttendance/workers/sqlAttendance.worker.js"` to scripts. Reuse installed BullMQ and `src/config/queue.js`; add only `mssql` because no installed dependency provides the SQL Server protocol.
Export a dedicated `hrRouter` from `src/modules/integration/index.js` and mount it
at `/hr/integrations` in `src/modules/index.js`; do not move SQL integration
internals into the HR module.

- [ ] **Step 5: Verify attendance and architecture**

Run: `node -c src/modules/hr/services/attendanceResolution.service.js`

Run: `npx jest src/test/hr src/test/integration/sqlAttendance src/test/architecture.contract.test.js --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit attendance ingestion**

```powershell
git add package.json package-lock.json src/modules/index.js src/modules/hr src/modules/integration src/test/hr src/test/integration/sqlAttendance
git commit -m "feat(hr): port attendance resolution and SQL ingestion"
```

---

### Task 5: Complete leave, balance, and overtime parity

**Files:**
- Modify: `src/modules/hr/models/leaveBalance.model.js`
- Modify: `src/modules/hr/models/leaveRequest.model.js`
- Modify: `src/modules/hr/models/overtimeRequest.model.js`
- Modify: `src/modules/hr/repositories/leave.repository.js`
- Modify: `src/modules/hr/repositories/overtime.repository.js`
- Modify: `src/modules/hr/services/leave.service.js`
- Modify: `src/modules/hr/services/overtime.service.js`
- Modify: `src/modules/hr/controllers/leave.controller.js`
- Modify: `src/modules/hr/controllers/overtime.controller.js`
- Modify: `src/modules/hr/validators/leave.validator.js`
- Modify: `src/modules/hr/validators/overtime.validator.js`
- Modify: `src/modules/hr/routes/index.js`
- Test: `src/test/hr/services/leave.lifecycle.test.js`
- Test: `src/test/hr/services/overtime.lifecycle.test.js`
- Test: `src/test/hr/routes/leave.routes.test.js`
- Test: `src/test/hr/routes/overtime.routes.test.js`

**Interfaces:**
- Produces: leave preview/create/approve/reject/cancel/refund, balance adjust/accrue/reset/carry-over, attachment-reference, and overtime create/approve/reject/cancel contracts under `/api/hr/*`.
- Consumes: `attendanceResolution.service`, `notification.public`, HR employee profiles, calendar policy, Audit public port, and Auth authorization.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test('repeated approval leaves one balance debit, one attendance result, and one inbox item', async () => {
  await service.approveRequest('leave-1', { decision: 'APPROVE' }, actor);
  await service.approveRequest('leave-1', { decision: 'APPROVE' }, actor);

  expect(await leaveRepository.findById('leave-1')).toMatchObject({ status: 'APPROVED' });
  expect(await balanceRepository.findByProfileAndYear('profile-1', 2026)).toMatchObject({ annualRemaining: 11 });
  expect(await attendanceRepository.findByRequestId('leave-1')).toHaveLength(1);
  expect(await notificationRepository.listForRecipient('account-1')).toHaveLength(1);
});
```

Add explicit cases for unpaid full day, paid half day, overlapping request,
cancel/refund, next approver, rejected OT, and concurrent manual attendance edit.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx jest src/test/hr/services/leave.lifecycle.test.js src/test/hr/services/overtime.lifecycle.test.js --runInBand`

Expected: FAIL on missing lifecycle behavior.

- [ ] **Step 3: Implement missing state transitions and notifications**

Use guarded repository updates such as `{ _id, status: 'PENDING' }` and stable
deduplication keys such as `leave:<id>:<status>:<recipientAccountId>`. Store only
attachment media references; do not port local absolute upload paths.

- [ ] **Step 4: Verify HR, Auth, Organization, and architecture**

Run: `npx jest src/test/hr src/test/auth src/test/organization src/test/notification src/test/architecture.contract.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit time-request parity**

```powershell
git add src/modules/hr src/test/hr
git commit -m "feat(hr): complete leave and overtime parity"
```

---

### Task 6: Port payroll and payroll adjustments

**Files:**
- Create: `src/modules/hr/models/payrollRun.model.js`
- Create: `src/modules/hr/models/payrollResult.model.js`
- Create: `src/modules/hr/models/payrollAdjustment.model.js`
- Create: `src/modules/hr/repositories/payroll.repository.js`
- Create: `src/modules/hr/services/payrollCalculation.service.js`
- Create: `src/modules/hr/services/payroll.service.js`
- Create: `src/modules/hr/services/payrollAdjustment.service.js`
- Create: `src/modules/hr/controllers/payroll.controller.js`
- Create: `src/modules/hr/validators/payroll.validator.js`
- Create: `src/modules/hr/dtos/payroll.dto.js`
- Modify: `src/modules/hr/routes/index.js`
- Modify: `src/modules/hr/public.js`
- Test: `src/test/hr/services/payrollCalculation.service.test.js`
- Test: `src/test/hr/services/payroll.lifecycle.test.js`
- Test: `src/test/hr/routes/payroll.routes.test.js`

**Interfaces:**
- Produces: `calculatePayroll({ month, year, profileIds, shadow })`.
- Produces: `finalizePayroll({ payrollRunId, expectedVersion }, actor)` and `markPayrollPaid({ payrollRunId, payrollResultIds, expectedVersion }, actor)`.
- Produces: `/api/hr/payrolls`, `/api/hr/payrolls/:id/finalize`, `/api/hr/payrolls/:id/mark-paid`, `/api/hr/payrolls/me`, and `/api/hr/payroll-adjustments`.
- Consumes: HR attendance summaries, approved leave/overtime, employee compensation snapshot, notification public port, and Audit public port.

- [ ] **Step 1: Write failing calculation fixtures**

Create sanitized fixtures covering a regular employee, mid-month start, unpaid
leave, paid holiday, approved OT, allowance, deduction, adjustment, and rounding.
Assert exact decimal values for work units, gross, total deductions, and net;
never use floating-point tolerance for stored money.

- [ ] **Step 2: Run payroll tests and verify failure**

Run: `npx jest src/test/hr/services/payrollCalculation.service.test.js src/test/hr/services/payroll.lifecycle.test.js --runInBand`

Expected: FAIL because payroll services do not exist.

- [ ] **Step 3: Implement pure calculation and immutable snapshots**

Represent money as integer VND. Persist the input snapshot used by each result,
including attendance totals, leave, OT, compensation, allowances, deductions,
adjustments, and formula version. Use one unique index per employee and period:

```js
payrollResultSchema.index({ payrollRunId: 1, profileId: 1 }, { unique: true });
payrollRunSchema.index({ month: 1, year: 1 }, { unique: true });
```

- [ ] **Step 4: Implement guarded lifecycle actions**

Finalize only `DRAFT` at `expectedVersion`; mark-paid only `FINALIZED` results
whose IDs are explicitly supplied. Return per-result success/failure DTOs and
never treat zero matched finalized rows as success.

- [ ] **Step 5: Run payroll and broad HR tests**

Run: `npx jest src/test/hr src/test/notification src/test/audit src/test/architecture.contract.test.js --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit payroll**

```powershell
git add src/modules/hr src/test/hr
git commit -m "feat(hr): port payroll lifecycle"
```

---

### Task 7: Port announcements, dashboard, and payroll email jobs

**Files:**
- Create: `src/modules/hr/models/announcement.model.js`
- Create: `src/modules/hr/models/payrollEmailJob.model.js`
- Create: `src/modules/hr/repositories/announcement.repository.js`
- Create: `src/modules/hr/repositories/payrollEmailJob.repository.js`
- Create: `src/modules/hr/services/announcement.service.js`
- Create: `src/modules/hr/services/hrDashboard.service.js`
- Create: `src/modules/hr/services/payrollEmail.service.js`
- Create: `src/modules/hr/workers/payrollEmail.worker.js`
- Create: `src/modules/hr/controllers/announcement.controller.js`
- Create: `src/modules/hr/controllers/hrDashboard.controller.js`
- Create: `src/modules/hr/dtos/announcement.dto.js`
- Modify: `src/modules/hr/routes/index.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `src/test/hr/services/announcement.service.test.js`
- Test: `src/test/hr/services/hrDashboard.service.test.js`
- Test: `src/test/hr/workers/payrollEmail.worker.test.js`

**Interfaces:**
- Produces: `/api/hr/announcements`, `/api/hr/dashboard`, and `POST /api/hr/payrolls/:id/email`.
- Consumes: Notification public port, Auth account/profile public data, media references, payroll results, installed BullMQ, and configured email transport.

- [ ] **Step 1: Write failing visibility and email idempotency tests**

Assert scheduled announcements notify eligible recipients once, reminders reuse
a distinct stable key, and replaying payroll email job
`payroll:<runId>:<resultId>:email` does not send twice.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx jest src/test/hr/services/announcement.service.test.js src/test/hr/services/hrDashboard.service.test.js src/test/hr/workers/payrollEmail.worker.test.js --runInBand`

Expected: FAIL because the files do not exist.

- [ ] **Step 3: Implement announcement, dashboard DTOs, and queued email**

Announcements own content and audience rules; Notification owns recipient inbox
state. Dashboard services compose repository aggregates and return DTOs. Email
jobs persist `PENDING`, `PROCESSING`, `SENT`, or `FAILED`, with attempt count and
last error code; they never store SMTP credentials. Add `nodemailer` and update
`package-lock.json`; reuse it directly rather than creating a transport
abstraction with one implementation.

- [ ] **Step 4: Verify HR and queue behavior**

Run: `npx jest src/test/hr src/test/notification src/test/architecture.contract.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit communication workflows**

```powershell
git add package.json package-lock.json src/modules/hr src/test/hr
git commit -m "feat(hr): add announcements and payroll delivery"
```

---

### Task 8: Extend migration, reconciliation, and shadow comparison

**Files:**
- Modify: `src/modules/hr/scripts/migrateLngHrData.js`
- Create: `src/modules/hr/scripts/compareLegacyPayroll.js`
- Create: `src/modules/hr/scripts/auditFullHrReadiness.js`
- Modify: `package.json`
- Test: `src/test/hr/scripts/migrateLngHrData.test.js`
- Test: `src/test/hr/scripts/compareLegacyPayroll.test.js`
- Test: `src/test/hr/scripts/auditFullHrReadiness.test.js`

**Interfaces:**
- Produces: `npm run migrate:hr:lng-hr -- --apply` while default invocation remains dry-run.
- Produces: `npm run compare:hr:payroll -- --month=7 --year=2026`.
- Produces: `npm run audit:hr:readiness` with non-zero exit when a cutover gate fails.
- Consumes: source `MONGO_URI` supplied only at runtime and target POD models through their module-owned migration adapters.

- [ ] **Step 1: Write failing idempotency and diff tests**

```js
test('payroll comparator reports the exact employee and field mismatch', () => {
  expect(comparePayrollRows(
    [{ employeeCode: 'E1', net: 1000 }],
    [{ employeeCode: 'E1', net: 900 }],
  )).toEqual([{ employeeCode: 'E1', field: 'net', legacy: 1000, pod: 900, delta: -100 }]);
});
```

Run the migration adapter twice against mocked repositories and assert the
second pass reports zero inserts and zero duplicate-key failures.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx jest src/test/hr/scripts --runInBand`

Expected: FAIL on missing full migration and comparison behavior.

- [ ] **Step 3: Add remaining collection mappings and exact reports**

Map holidays, rotations, payroll adjustments, payroll runs/results,
announcements, their attachment media references, notification read state, and sync watermarks after existing
profile/time mappings. Every output includes `read`, `mapped`, `inserted`,
`updated`, `unchanged`, `skipped`, and `failed`; skipped rows include source ID
and stable reason code.

- [ ] **Step 4: Implement cutover readiness checks**

Fail readiness when identity references are missing, attendance reconciliation
has unresolved rows, SQL watermark lags, payroll diffs exist, migration is not
idempotent, or required permission/route registrations are missing. Never print
connection strings or salary details.

- [ ] **Step 5: Run script and architecture tests**

Run: `npx jest src/test/hr/scripts src/test/architecture.contract.test.js --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit migration and shadow tooling**

```powershell
git add package.json src/modules/hr/scripts src/test/hr/scripts
git commit -m "feat(hr): add full migration and payroll parity tooling"
```

---

### Task 9: Wire Notification and HR navigation in `lng-web-fe`

**Files:**
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\services\endpoints.js`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\constants\routes.js`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\layouts\sidebarNavigation.js`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\layouts\AppHeader.jsx`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\notifications\api\notification.queries.js`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\notifications\api\notification.mutations.js`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\notifications\components\NotificationPopover.jsx`
- Test: `C:\lng_system\lng-web\lng-web-fe\src\features\notifications\notificationApi.test.js`
- Test: `C:\lng_system\lng-web\lng-web-fe\src\layouts\sidebarNavigation.test.js`
- Test: `C:\lng_system\lng-web\lng-web-fe\src\services\endpoints.contract.test.js`

**Interfaces:**
- Consumes: `/api/notifications` inbox/unread/read APIs and HR permission codes from Tasks 2–3.
- Produces: notification header popover polling every 60 seconds while authenticated and permission-filtered HR navigation groups.

- [ ] **Step 1: Write failing endpoint, polling, and navigation tests**

```js
test('unread adapter returns the count from the shared API response', async () => {
  const count = await fetchUnreadCount(async (path) => {
    assert.equal(path, '/api/notifications/unread-count');
    return { data: { unreadCount: 2 } };
  });

  assert.equal(count, 2);
});
```

Assert payroll and integration navigation leaves are absent without their exact
permissions.

- [ ] **Step 2: Run focused frontend tests and verify failure**

Run from `lng-web-fe`: `node --test src/features/notifications/notificationApi.test.js src/layouts/sidebarNavigation.test.js src/services/endpoints.contract.test.js`

Expected: FAIL because Notification endpoints/components and new routes are absent.

- [ ] **Step 3: Implement endpoints, queries, popover, and navigation**

Reuse the existing API client and query key conventions. The popover renders
unread first, then newest; clicking an item marks it read and navigates only to
a server-provided internal route. Do not add a websocket client.

- [ ] **Step 4: Verify frontend foundation**

Run from `lng-web-fe`: `node --test src/features/notifications/notificationApi.test.js src/layouts/sidebarNavigation.test.js src/services/endpoints.contract.test.js`

Run: `npm run build`

Expected: tests and build PASS.

- [ ] **Step 5: Commit frontend shell changes in the frontend repository**

```powershell
git add src/services/endpoints.js src/constants/routes.js src/layouts/sidebarNavigation.js src/layouts/AppHeader.jsx src/features/notifications src/layouts/sidebarNavigation.test.js src/services/endpoints.contract.test.js
git commit -m "feat(hr): add notifications and HR navigation"
```

---

### Task 10: Build the remaining HR frontend workflows

**Files:**
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-payroll\api\hrPayroll.queries.js`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-payroll\api\hrPayroll.mutations.js`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-payroll\pages\PayrollRunsPage.jsx`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-payroll\pages\MyPayslipsPage.jsx`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-payroll\components\PayrollReviewDrawer.jsx`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-payroll\components\PayrollActionDialog.jsx`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-communication\pages\AnnouncementsPage.jsx`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-settings\pages\HrSettingsPage.jsx`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-time\pages\SchedulePage.jsx`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-time\pages\AttendanceDeskPage.jsx`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\routes\index.jsx`
- Test: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-payroll\hrPayrollApi.test.js`
- Test: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-payroll\hrPayrollComposition.test.js`
- Test: `C:\lng_system\lng-web\lng-web-fe\src\features\hr-communication\announcementComposition.test.js`

**Interfaces:**
- Consumes: Tasks 2, 4–8 HTTP contracts and server-computed record capabilities.
- Produces: My HR, People & Time, Payroll, Communication, and Configuration workflows within the existing application shell.

- [ ] **Step 1: Write failing contract and composition tests**

Assert payroll rows map integer VND without floating conversion, finalize and
mark-paid buttons require server capabilities, dialogs display partial-result
failures, and no component checks a role name.

- [ ] **Step 2: Run focused tests and verify failure**

Run from `lng-web-fe`: `node --test src/features/hr-payroll/*.test.js src/features/hr-communication/*.test.js`

Expected: FAIL because pages and API adapters do not exist.

- [ ] **Step 3: Implement API adapters and pages with existing primitives**

Reuse MUI, TanStack Query, React Hook Form, Zod, `OperationsPageShell`, shared
tables, filters, drawers, and dialogs. Finalize and mark-paid show a preview,
explicit confirmation, pending state, and per-record outcome; mutations have no
automatic retry.

- [ ] **Step 4: Wire routes and complete time/calendar UI**

Add lazy routes under `/hr`, permission guards matching backend permissions,
holiday/rotation controls to Schedule, SQL sync status to HR Settings, and
attendance reconciliation evidence to Attendance Desk.

- [ ] **Step 5: Verify all frontend tests, lint, and build**

Run from `lng-web-fe`: `node --test "src/**/*.test.js"`

Run: `npm run lint`

Run: `npm run build`

Expected: all commands PASS.

- [ ] **Step 6: Commit frontend workflows**

```powershell
git add src/features/hr-payroll src/features/hr-communication src/features/hr-settings src/features/hr-time src/routes/index.jsx
git commit -m "feat(hr): add payroll and HR administration UI"
```

---

### Task 11: Rehearse shadow payroll and cutover

**Files:**
- Create: `docs/hr/runbooks/shadow-payroll.md`
- Create: `docs/hr/runbooks/hr-cutover.md`
- Create: `docs/hr/runbooks/hr-rollback.md`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Test: `src/test/hr/scripts/auditFullHrReadiness.test.js`

**Interfaces:**
- Consumes: migration, comparator, readiness audit, SQL worker, backend APIs, frontend build, and production environment configuration.
- Produces: an executable maintenance-window checklist with evidence paths and explicit stop/go gates.

- [ ] **Step 1: Write the runbooks with exact commands and stop conditions**

The shadow runbook runs migration dry-run, applies to the target database after
printing both database names, calculates shadow payroll with delivery disabled,
runs `compare:hr:payroll`, and archives the summary without salaries. The
cutover runbook freezes legacy writes/workers, backs up, runs delta migration,
runs readiness audit, enables POD workers/UI, smoke-tests, and records the first
production write. The rollback runbook permits reopening legacy writes only
before that first POD write.

- [ ] **Step 2: Add configuration documentation without secrets**

Add only key names and safe defaults to `.env.example`: SQL host/database/port,
sync enabled flag, cron expression, lookback days, batch limit, delivery
suppression flag, and payroll email concurrency/delay. Keep all credentials
empty.

- [ ] **Step 3: Run full backend verification**

Run: `npm run test:architecture -- --runInBand`

Run: `npm run test:auth -- --runInBand`

Run: `npm run test:organization -- --runInBand`

Run: `npx jest src/test/hr src/test/notification src/test/integration/sqlAttendance --runInBand`

Run: `npm test -- --runInBand`

Expected: every command PASS before any production rehearsal.

- [ ] **Step 4: Run full frontend verification**

Run from `lng-web-fe`: `node --test "src/**/*.test.js"`

Run: `npm run lint`

Run: `npm run build`

Expected: every command PASS.

- [ ] **Step 5: Perform non-production rehearsal**

Use a restored copy of the source HR database and the POD development database.
Record migration counts, unresolved mappings, SQL watermark, attendance
reconciliation, payroll differences, API smoke results, and rollback result.
Do not proceed if any cutover gate fails.

- [ ] **Step 6: Commit runbooks and safe configuration**

```powershell
git add docs/hr/runbooks .env.example docker-compose.yml src/test/hr/scripts/auditFullHrReadiness.test.js
git commit -m "docs(hr): add shadow payroll and cutover runbooks"
```

## Program Completion Gate

The old HR backend may be stopped only after Task 11 passes in a production
maintenance window, at least one complete shadow payroll period has zero
unapproved differences, the second period is completed when the first had a
mismatch or incomplete policy coverage, and the seven-day read-only audit
reference window closes. After the first POD production HR write, recovery is
forward-only; do not reopen the old backend as a concurrent writer.
