# HR Time And Attendance Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add time and attendance operations to the portal HR module without duplicate identity/org data, external time-clock sync, or payroll behavior.

**Architecture:** Keep all time-domain records inside `src/modules/hr`. A single schedule resolver determines the working context for attendance, leave, and overtime; business records snapshot that context when their state changes so later schedule edits cannot rewrite historical results.

**Tech Stack:** Node.js, Express 5, CommonJS, Mongoose 9, Joi 18, Jest 30, existing portal scoped RBAC.

## Global Constraints

- No new dependency, SQL connection, time-clock worker, notification, attachment upload, payroll calculation, or payroll-period lock.
- Do not create Account, Role, Department, Team, AuditLog, SaturdayRotation, or OfficeNetwork models.
- Cross-module calls use only `auth/public.js` and `organization/public.js`.
- Controllers validate/return HTTP only; services own state transitions; repositories own Mongoose queries; DTOs shape every response.
- Read-only queries use `.lean()`.
- Dates are local `YYYY-MM-DD` keys resolved with the work location IANA timezone. Time strings must be `HH:mm`.
- Leave entitlement uses integer half-day units. Overtime uses integer minutes. Do not use floating-point work-day values.
- Default Phase 2 approval is one terminal decision, not a configurable multi-level approval engine.
- Do not stage/revert unrelated dirty worktree files.

---

## File Map

- Modify: `src/modules/hr/constants/hr.constants.js`, `src/modules/hr/routes/index.js`, `src/modules/hr/public.js`, `src/modules/auth/scripts/seedRbac.js`.
- Create scheduling models: `workLocation.model.js`, `shift.model.js`, `shiftAssignment.model.js`, `calendarOverride.model.js`.
- Create transaction models: `attendanceDaily.model.js`, `leaveBalance.model.js`, `leaveRequest.model.js`, `overtimeRequest.model.js`.
- Create repositories: `schedule.repository.js`, `attendance.repository.js`, `leave.repository.js`, `overtime.repository.js`.
- Create DTOs/validators/services/controllers named `schedule`, `attendance`, `leave`, `overtime` under their existing HR layer folders.
- Create `scheduleResolver.service.js`, `docs/hr/hr-time-attendance-phase-2-migration-map.md`, and `src/modules/hr/scripts/auditHrTimeReadiness.js`.
- Add focused tests beneath matching `src/test/hr/` folders.

---

### Task 1: Add Phase 2 Constants And Permissions

**Files:**
- Modify: `src/modules/hr/constants/hr.constants.js`
- Modify: `src/modules/auth/scripts/seedRbac.js`
- Test: `src/test/hr/constants/hrTime.constants.test.js`
- Test: `src/test/auth/rbac.hr-permissions.test.js`

**Interfaces:**
- Produces `hrTimePermissions`, `hrAttendanceStatuses`, `hrRequestStatuses`, `hrLeaveTypes`, and `hrCalendarOverrideKinds`.
- Produces `HR_SCHEDULE:READ|WRITE`, `HR_ATTENDANCE:READ|WRITE|MANAGE`, `HR_LEAVE:READ|WRITE|APPROVE`, and `HR_OVERTIME:READ|WRITE|APPROVE`.

- [ ] **Step 1: Write failing contracts**

```js
const { hrTimePermissions } = require('../../../modules/hr/constants/hr.constants');

test('exports time operation permissions', () => {
  expect(hrTimePermissions).toEqual(expect.objectContaining({
    SCHEDULE_READ: 'HR_SCHEDULE:READ',
    ATTENDANCE_MANAGE: 'HR_ATTENDANCE:MANAGE',
    LEAVE_APPROVE: 'HR_LEAVE:APPROVE',
    OVERTIME_APPROVE: 'HR_OVERTIME:APPROVE',
  }));
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npm test -- src/test/hr/constants/hrTime.constants.test.js src/test/auth/rbac.hr-permissions.test.js --runInBand`

Expected: FAIL because time permissions are absent.

- [ ] **Step 3: Add the constants and seed roles**

```js
const hrTimePermissions = Object.freeze({
  SCHEDULE_READ: 'HR_SCHEDULE:READ',
  SCHEDULE_WRITE: 'HR_SCHEDULE:WRITE',
  ATTENDANCE_READ: 'HR_ATTENDANCE:READ',
  ATTENDANCE_WRITE: 'HR_ATTENDANCE:WRITE',
  ATTENDANCE_MANAGE: 'HR_ATTENDANCE:MANAGE',
  LEAVE_READ: 'HR_LEAVE:READ',
  LEAVE_WRITE: 'HR_LEAVE:WRITE',
  LEAVE_APPROVE: 'HR_LEAVE:APPROVE',
  OVERTIME_READ: 'HR_OVERTIME:READ',
  OVERTIME_WRITE: 'HR_OVERTIME:WRITE',
  OVERTIME_APPROVE: 'HR_OVERTIME:APPROVE',
});
```

Seed every permission for `ADMIN`; read/approve for `MANAGER` and `LEADER`; self-write permissions for `USER`. Service-level scope checks remain mandatory.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/test/hr/constants/hrTime.constants.test.js src/test/auth/rbac.hr-permissions.test.js --runInBand`

Expected: PASS.

```bash
git add src/modules/hr/constants/hr.constants.js src/modules/auth/scripts/seedRbac.js src/test/hr/constants/hrTime.constants.test.js src/test/auth/rbac.hr-permissions.test.js
git commit -m "feat(hr): add time operation permissions"
```

### Task 2: Add Schedule Persistence

**Files:**
- Create: `src/modules/hr/models/workLocation.model.js`
- Create: `src/modules/hr/models/shift.model.js`
- Create: `src/modules/hr/models/shiftAssignment.model.js`
- Create: `src/modules/hr/models/calendarOverride.model.js`
- Create: `src/modules/hr/repositories/schedule.repository.js`
- Test: `src/test/hr/models/schedule.models.test.js`
- Test: `src/test/hr/repositories/schedule.repository.test.js`

**Interfaces:**
- Produces `findEffectiveAssignment(profileId, workDateKey)` and `findCalendarOverrides(dateKey, context)`.
- An active assignment covers an effective date when `effectiveFrom <= date <= effectiveTo`, with null `effectiveTo` meaning open-ended.

- [ ] **Step 1: Write failing indexes tests**

```js
test('has one active calendar override per local date and scope', () => {
  const CalendarOverride = require('../../../modules/hr/models/calendarOverride.model');
  expect(CalendarOverride.schema.indexes()).toContainEqual([
    { dateKey: 1, scopeType: 1, scopeId: 1 },
    expect.objectContaining({ unique: true }),
  ]);
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npm test -- src/test/hr/models/schedule.models.test.js --runInBand`

Expected: FAIL because schedule models do not exist.

- [ ] **Step 3: Implement minimum models**

| Model | Required fields and constraints |
| --- | --- |
| WorkLocation | unique uppercase `code`, `name`, IANA `timezone`, `status` |
| Shift | unique uppercase `code`, optional `workLocationId`, `startTime`, `endTime`, `breakMinutes`, `graceMinutes`, ISO `workdays`, `status` |
| ShiftAssignment | `profileId`, `shiftId`, `workLocationId`, `effectiveFrom`, nullable `effectiveTo`, `status`, creator snapshot |
| CalendarOverride | `dateKey`, `kind` (`HOLIDAY`, `REST_DAY`, `WORKING_DAY`), `scopeType`, nullable `scopeId`, `name`, `status`, actor snapshot |

Use soft deactivation for any referenced schedule record. Validate time format in Joi, not in Mongoose. Shift duration may cross midnight but must be no more than 960 minutes.

```js
schema.index(
  { dateKey: 1, scopeType: 1, scopeId: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);
```

- [ ] **Step 4: Implement lean repository methods**

```js
async function findEffectiveAssignment(profileId, workDateKey) {
  return ShiftAssignment.findOne({
    profileId,
    status: 'ACTIVE',
    effectiveFrom: { $lte: workDateKey },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: workDateKey } }],
  }).sort({ effectiveFrom: -1, _id: -1 }).lean();
}
```

```js
async function findCalendarOverrides(dateKey, context) {
  return CalendarOverride.find({
    dateKey,
    status: 'ACTIVE',
    $or: [
      { scopeType: 'GLOBAL', scopeId: null },
      { scopeType: 'WORK_LOCATION', scopeId: context.workLocationId },
      { scopeType: 'DEPARTMENT', scopeId: context.departmentId },
      { scopeType: 'TEAM', scopeId: context.teamId },
      { scopeType: 'PROFILE', scopeId: context.profileId },
    ],
  }).lean();
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm test -- src/test/hr/models/schedule.models.test.js src/test/hr/repositories/schedule.repository.test.js --runInBand`

Expected: PASS.

```bash
git add src/modules/hr/models src/modules/hr/repositories/schedule.repository.js src/test/hr/models/schedule.models.test.js src/test/hr/repositories/schedule.repository.test.js
git commit -m "feat(hr): add schedule persistence"
```

### Task 3: Add Schedule Management API

**Files:**
- Create: `src/modules/hr/dtos/schedule.dto.js`
- Create: `src/modules/hr/validators/schedule.validator.js`
- Create: `src/modules/hr/services/schedule.service.js`
- Create: `src/modules/hr/controllers/schedule.controller.js`
- Modify: `src/modules/hr/repositories/schedule.repository.js`
- Modify: `src/modules/hr/routes/index.js`
- Test: `src/test/hr/validators/schedule.validator.test.js`
- Test: `src/test/hr/services/schedule.service.test.js`
- Test: `src/test/hr/routes/schedule.routes.test.js`

**Interfaces:**
- Produces collection create/list and single-record patch endpoints for work locations, shifts, assignments, and calendar overrides.
- Produces `assertNoAssignmentOverlap(profileId, effectiveFrom, effectiveTo, excludedId)`.

- [ ] **Step 1: Write failing validation and overlap tests**

```js
test('rejects invalid shift times and a shift longer than sixteen hours', () => {
  const { validate, createShiftSchema } = require('../../../modules/hr/validators/schedule.validator');
  expect(validate(createShiftSchema, { code: 'N1', name: 'Night', startTime: '25:00' }).details).toBeTruthy();
});

test('rejects an overlapping active assignment', async () => {
  repository.findAssignmentOverlaps.mockResolvedValue([{ id: 'existing' }]);
  await expect(service.createAssignment(validPayload, auth)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
});
```

- [ ] **Step 2: Implement validation, DTOs, service, and routes**

Use `/^([01]\\d|2[0-3]):[0-5]\\d$/` and `/^\\d{4}-\\d{2}-\\d{2}$/`. The assignment conflict query is:

```js
{
  profileId,
  status: 'ACTIVE',
  effectiveFrom: { $lte: effectiveTo || '9999-12-31' },
  $or: [{ effectiveTo: null }, { effectiveTo: { $gte: effectiveFrom } }],
}
```

Reject deleted profiles, inactive shifts, inactive work locations, and duplicated active calendar scope/date. DTOs return id/code/name/status and explicit concrete fields, never Mongo documents.

Route contract:

```text
GET|POST /work-locations
PATCH /work-locations/:id
GET|POST /shifts
PATCH /shifts/:id
GET|POST /shift-assignments
PATCH /shift-assignments/:id
GET|POST /calendar-overrides
PATCH /calendar-overrides/:id
```

Reads require schedule read/write; writes require schedule write.

- [ ] **Step 3: Verify and commit**

Run: `npm test -- src/test/hr/validators/schedule.validator.test.js src/test/hr/services/schedule.service.test.js src/test/hr/routes/schedule.routes.test.js --runInBand`

Expected: PASS for invalid times, duration, inactive references, overlapping assignments, and calendar conflict.

```bash
git add src/modules/hr/dtos/schedule.dto.js src/modules/hr/validators/schedule.validator.js src/modules/hr/services/schedule.service.js src/modules/hr/controllers/schedule.controller.js src/modules/hr/repositories/schedule.repository.js src/modules/hr/routes/index.js src/test/hr/validators/schedule.validator.test.js src/test/hr/services/schedule.service.test.js src/test/hr/routes/schedule.routes.test.js
git commit -m "feat(hr): add schedule management api"
```

### Task 4: Implement the Shared Schedule Resolver

**Files:**
- Create: `src/modules/hr/services/scheduleResolver.service.js`
- Test: `src/test/hr/services/scheduleResolver.service.test.js`

**Interfaces:**
- Produces `resolveWorkContext({ profileId, workDateKey })`.
- Returns `SCHEDULE_UNRESOLVED` or a snapshot with location, shift, timezone, calendar decision, and `isWorkingDay`.

- [ ] **Step 1: Write failing resolution tests**

```js
test('uses profile override before team, department, location, and global', async () => {
  repository.findCalendarOverrides.mockResolvedValue([
    { scopeType: 'GLOBAL', kind: 'HOLIDAY' },
    { scopeType: 'TEAM', kind: 'REST_DAY' },
    { scopeType: 'PROFILE', kind: 'WORKING_DAY' },
  ]);
  await expect(resolveWorkContext(input)).resolves.toMatchObject({
    isWorkingDay: true,
    calendarOverride: { scopeType: 'PROFILE' },
  });
});
```

- [ ] **Step 2: Implement deterministic precedence**

```js
const priority = Object.freeze({
  GLOBAL: 0,
  WORK_LOCATION: 1,
  DEPARTMENT: 2,
  TEAM: 3,
  PROFILE: 4,
});

function selectOverride(items) {
  return [...items].sort((left, right) => priority[right.scopeType] - priority[left.scopeType])[0] || null;
}
```

Resolve profile -> assignment -> shift/location -> override. If any schedule dependency is absent/inactive, return `SCHEDULE_UNRESOLVED`; never guess a default shift. With no override, use ISO weekday membership in shift `workdays`. For overnight shifts, anchor `workDateKey` to the local date on which the shift starts.

- [ ] **Step 3: Verify and commit**

Run: `npm test -- src/test/hr/services/scheduleResolver.service.test.js --runInBand`

Expected: PASS for no assignment, global/team/profile precedence, holiday, make-up workday, and overnight shift context.

```bash
git add src/modules/hr/services/scheduleResolver.service.js src/test/hr/services/scheduleResolver.service.test.js
git commit -m "feat(hr): resolve effective work schedules"
```

### Task 5: Add Daily Attendance

**Files:**
- Create: `src/modules/hr/models/attendanceDaily.model.js`
- Create: `src/modules/hr/repositories/attendance.repository.js`
- Create: `src/modules/hr/dtos/attendance.dto.js`
- Create: `src/modules/hr/validators/attendance.validator.js`
- Create: `src/modules/hr/services/attendance.service.js`
- Create: `src/modules/hr/controllers/attendance.controller.js`
- Modify: `src/modules/hr/routes/index.js`
- Test: `src/test/hr/models/attendanceDaily.model.test.js`
- Test: `src/test/hr/services/attendance.service.test.js`
- Test: `src/test/hr/routes/attendance.routes.test.js`

**Interfaces:**
- Produces `checkIn(auth, payload)`, `checkOut(auth, payload)`, `listAttendance(query, auth)`, `adjustAttendance(id, payload, auth)`, and `reconcileApprovedLeave(profileId, dateKeys)`.
- Self endpoints never accept a profile id.

- [ ] **Step 1: Write failing daily-record tests**

```js
test('has one attendance row per profile and work date', () => {
  const AttendanceDaily = require('../../../modules/hr/models/attendanceDaily.model');
  expect(AttendanceDaily.schema.indexes()).toContainEqual([
    { profileId: 1, workDateKey: 1 },
    { unique: true },
  ]);
});

test('rejects check-in without an effective schedule', async () => {
  resolver.resolveWorkContext.mockResolvedValue({ status: 'SCHEDULE_UNRESOLVED' });
  await expect(service.checkIn(auth, { occurredAt: '2026-07-18T01:00:00.000Z' }))
    .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
});
```

- [ ] **Step 2: Implement schema, computation, and state guards**

Store `scheduleSnapshot`, check-in/out instants, late/early/worked minutes, source, and `manualAdjustments[]`. Each adjustment records actor id/name, reason, timestamp, before and after values.

```js
async function checkIn(auth, { occurredAt }) {
  const profile = await getRequiredProfile(auth.accountId);
  const context = await resolveContextForInstant(profile, occurredAt);
  assertCanCheckIn(context);
  return repository.createDaily({
    profileId: profile.id,
    workDateKey: context.workDateKey,
    status: 'PRESENT',
    checkInAt: occurredAt,
    source: 'SELF_SERVICE',
    scheduleSnapshot: context.snapshot,
  });
}
```

Reject duplicate check-in, check-out without an open eligible record, rest/holiday check-in, approved full-day leave, and unresolved schedule. Check-out may attach only to the current or preceding overnight work date. Manual changes require `HR_ATTENDANCE:MANAGE` and a non-empty reason; they append history rather than silently overwrite data. List reads require global/scoped access; `/attendance/me` is self-only.

- [ ] **Step 3: Add routes, verify, and commit**

```text
GET /attendance
GET /attendance/me
POST /attendance/check-in
POST /attendance/check-out
PATCH /attendance/:attendanceId
```

Run: `npm test -- src/test/hr/models/attendanceDaily.model.test.js src/test/hr/services/attendance.service.test.js src/test/hr/routes/attendance.routes.test.js --runInBand`

Expected: PASS for duplicate event, overnight checkout, self-only operation, manual history, holiday/rest-day rejection, and scoped reads.

```bash
git add src/modules/hr/models/attendanceDaily.model.js src/modules/hr/repositories/attendance.repository.js src/modules/hr/dtos/attendance.dto.js src/modules/hr/validators/attendance.validator.js src/modules/hr/services/attendance.service.js src/modules/hr/controllers/attendance.controller.js src/modules/hr/routes/index.js src/test/hr/models/attendanceDaily.model.test.js src/test/hr/services/attendance.service.test.js src/test/hr/routes/attendance.routes.test.js
git commit -m "feat(hr): add daily attendance workflow"
```

### Task 6: Add Leave Balance And Request Workflow

**Files:**
- Create: `src/modules/hr/models/leaveBalance.model.js`
- Create: `src/modules/hr/models/leaveRequest.model.js`
- Create: `src/modules/hr/repositories/leave.repository.js`
- Create: `src/modules/hr/dtos/leave.dto.js`
- Create: `src/modules/hr/validators/leave.validator.js`
- Create: `src/modules/hr/services/leave.service.js`
- Create: `src/modules/hr/controllers/leave.controller.js`
- Modify: `src/modules/hr/services/attendance.service.js`
- Modify: `src/modules/hr/routes/index.js`
- Test: `src/test/hr/services/leave.service.test.js`
- Test: `src/test/hr/services/attendance.service.test.js`
- Test: `src/test/hr/routes/leave.routes.test.js`

**Interfaces:**
- Produces balance read/upsert, request create/list/approve/reject/cancel.
- Consumes `resolveWorkContext` and `attendanceService.reconcileApprovedLeave`.

- [ ] **Step 1: Write failing race and overlap tests**

```js
test('approves only one request when both consume the final balance', async () => {
  repository.consumeBalanceUnits.mockResolvedValueOnce({ modifiedCount: 1 }).mockResolvedValueOnce({ modifiedCount: 0 });
  await expect(service.approveRequest(firstId, approver)).resolves.toMatchObject({ status: 'APPROVED' });
  await expect(service.approveRequest(secondId, approver)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
});

test('rejects overlap with a pending request', async () => {
  repository.findOverlappingRequests.mockResolvedValue([{ id: 'existing' }]);
  await expect(service.createRequest(payload, requester)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
});
```

- [ ] **Step 2: Implement balance schema and request snapshots**

Balance is unique by `profileId, year, leaveType`, with `entitledUnits`, `adjustmentUnits`, `usedUnits`, and history. Request stores requester/department/team snapshots, calculated working-date snapshots, requested units, state, and decision/cancellation actor snapshots. A full working day is two units; a morning/afternoon request is one unit and may span exactly one date only.

- [ ] **Step 3: Implement transactional approval**

Create snapshots for each local date in range and omit rest/holiday dates. Reject zero working dates and overlap with PENDING/APPROVED requests.

```js
const consumed = await LeaveBalance.updateOne(
  {
    profileId: request.profileId,
    year: request.year,
    leaveType: request.leaveType,
    $expr: {
      $gte: [
        { $add: ['$entitledUnits', '$adjustmentUnits', { $multiply: ['$usedUnits', -1] }] },
        request.requestedUnits,
      ],
    },
  },
  { $inc: { usedUnits: request.requestedUnits } },
  { session },
);
if (consumed.modifiedCount !== 1) throw insufficientBalanceConflict();
```

Use one Mongoose session to consume balance and set request state. Global approval or `authPublic.canAccessScope` against request snapshots is required; self approval is forbidden. Requester cancels PENDING. An eligible approver may cancel APPROVED leave only before the first work date and refunds exactly original units in the same transaction. Reconcile attendance after terminal success.

- [ ] **Step 4: Add routes, verify, and commit**

```text
GET /leave-balances/me?year=2026
GET|PUT /leave-balances/:profileId/:year/:leaveType
GET|POST /leave-requests
GET /leave-requests/me
POST /leave-requests/:requestId/approve
POST /leave-requests/:requestId/reject
POST /leave-requests/:requestId/cancel
```

Run: `npm test -- src/test/hr/services/leave.service.test.js src/test/hr/routes/leave.routes.test.js --runInBand`

Expected: PASS for half-days, workday filtering, overlap, final-balance race, self denial, org-transfer snapshot, rejection, and refund.

```bash
git add src/modules/hr/models/leaveBalance.model.js src/modules/hr/models/leaveRequest.model.js src/modules/hr/repositories/leave.repository.js src/modules/hr/dtos/leave.dto.js src/modules/hr/validators/leave.validator.js src/modules/hr/services/leave.service.js src/modules/hr/controllers/leave.controller.js src/modules/hr/services/attendance.service.js src/modules/hr/routes/index.js src/test/hr/services/leave.service.test.js src/test/hr/services/attendance.service.test.js src/test/hr/routes/leave.routes.test.js
git commit -m "feat(hr): add leave balances and requests"
```

### Task 7: Add Overtime Request Workflow

**Files:**
- Create: `src/modules/hr/models/overtimeRequest.model.js`
- Create: `src/modules/hr/repositories/overtime.repository.js`
- Create: `src/modules/hr/dtos/overtime.dto.js`
- Create: `src/modules/hr/validators/overtime.validator.js`
- Create: `src/modules/hr/services/overtime.service.js`
- Create: `src/modules/hr/controllers/overtime.controller.js`
- Modify: `src/modules/hr/routes/index.js`
- Test: `src/test/hr/services/overtime.service.test.js`
- Test: `src/test/hr/routes/overtime.routes.test.js`

**Interfaces:**
- Produces create/list/approve/reject/cancel endpoints.
- Uses the same scoped-approval checks as leave, extracted to `hrApproval.service.js` only if both services need more than one shared helper.

- [ ] **Step 1: Write failing duration and approval tests**

```js
test('allows a partial approval expressed in integer minutes', async () => {
  await expect(service.approveRequest(requestId, { approvedMinutes: 90 }, approver))
    .resolves.toMatchObject({ approvedMinutes: 90, status: 'APPROVED' });
});

test('forbids self approval', async () => {
  await expect(service.approveRequest(requestId, {}, requester))
    .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
});
```

- [ ] **Step 2: Implement the minimum workflow**

Store work date, requested/approved minutes, calendar class, requester/org snapshots, reason, state, and actor snapshots. Validate 30 through 960 same-work-date minutes. Reject a requested interval overlapping normal shift unless actor has attendance manage permission. Overtime does not change attendance or payroll fields.

- [ ] **Step 3: Add routes, verify, and commit**

```text
GET|POST /overtime-requests
GET /overtime-requests/me
POST /overtime-requests/:requestId/approve
POST /overtime-requests/:requestId/reject
POST /overtime-requests/:requestId/cancel
```

Run: `npm test -- src/test/hr/services/overtime.service.test.js src/test/hr/routes/overtime.routes.test.js --runInBand`

Expected: PASS for minute duration, calendar class, normal-shift overlap, partial approval, scope checks, self denial, and cancellation.

```bash
git add src/modules/hr/models/overtimeRequest.model.js src/modules/hr/repositories/overtime.repository.js src/modules/hr/dtos/overtime.dto.js src/modules/hr/validators/overtime.validator.js src/modules/hr/services/overtime.service.js src/modules/hr/controllers/overtime.controller.js src/modules/hr/routes/index.js src/test/hr/services/overtime.service.test.js src/test/hr/routes/overtime.routes.test.js
git commit -m "feat(hr): add overtime requests"
```

### Task 8: Safe Public Reads, Migration Notes, And Verification

**Files:**
- Modify: `src/modules/hr/public.js`
- Create: `src/modules/hr/scripts/auditHrTimeReadiness.js`
- Create: `src/modules/hr/scripts/ensureHrTimeIndexes.js`
- Create: `docs/hr/hr-time-attendance-phase-2-migration-map.md`
- Test: `src/test/hr/public.time.contract.test.js`
- Test: `src/test/hr/scripts/auditHrTimeReadiness.test.js`
- Test: `src/test/hr/scripts/ensureHrTimeIndexes.test.js`

**Interfaces:**
- Produces `getAttendanceSummaryByProfileIds(profileIds, dateRange)` and `getApprovedTimeRecords(profileId, dateRange)`.
- Does not expose any write/import port in Phase 2.

- [ ] **Step 1: Write failing safety tests**

```js
test('exposes safe time reads but no external import write port', () => {
  const hrPublic = require('../../modules/hr/public');
  expect(typeof hrPublic.getAttendanceSummaryByProfileIds).toBe('function');
  expect(typeof hrPublic.getApprovedTimeRecords).toBe('function');
  expect(hrPublic.recordExternalAttendance).toBeUndefined();
});
```

- [ ] **Step 2: Implement safe reads and a read-only audit**

Public reads include profile id, work date, attendance state, approved leave units, and approved OT minutes. Exclude reasons, adjustment actor history, and sensitive profile data. The audit reports active profiles with no active assignment and duplicate active assignment windows using only `find`, `aggregate`, and `countDocuments`.

The index script is an explicit, idempotent deployment prerequisite because production disables Mongoose `autoIndex`. It verifies existing active leave requests do not have duplicate `profileId + conflictKeys` values and active overtime requests do not have duplicate canonical interval keys, then creates the unique `HrLeaveRequest` and `HrOvertimeRequest` indexes declared by the schemas. It must fail without modifying requests when duplicates exist, and it must be safe to rerun.

- [ ] **Step 3: Write the migration map**

Map old HR models as follows:

```text
Employee -> HrEmployeeProfile
Shift -> HrShift plus HrShiftAssignment
Holiday and SaturdayRotation -> HrCalendarOverride
Attendance -> HrAttendanceDaily
Leave and LeaveBalance -> HrLeaveRequest and HrLeaveBalance
Overtime -> HrOvertimeRequest
OfficeNetwork, AttendanceSyncLog, and Payroll -> not imported in Phase 2
```

State explicitly that production migration needs its own reviewed data-import plan after portal HR master data exists.

- [ ] **Step 4: Run final verification**

```bash
node -c src/modules/hr/services/scheduleResolver.service.js
node -c src/modules/hr/services/attendance.service.js
node -c src/modules/hr/services/leave.service.js
node -c src/modules/hr/services/overtime.service.js
npm test -- src/test/hr --runInBand
npm test -- src/test/auth/rbac.hr-permissions.test.js --runInBand
npm run test:architecture -- --runInBand
```

Expected: syntax, HR tests, and RBAC tests PASS. Architecture has no new HR violation; report any existing non-HR failure by file path.

- [ ] **Step 5: Commit public reads and documentation**

```bash
git add src/modules/hr/public.js src/modules/hr/scripts/auditHrTimeReadiness.js docs/hr/hr-time-attendance-phase-2-migration-map.md src/test/hr/public.time.contract.test.js src/test/hr/scripts/auditHrTimeReadiness.test.js
git commit -m "docs(hr): define time attendance migration"
```

---

## Self-Review

- Schedule, attendance, leave, overtime, RBAC, safe public reads, migration documentation, and verification each have a concrete task.
- Names are consistent: `HrAttendanceDaily`, `HrLeaveRequest`, `HrOvertimeRequest`, `resolveWorkContext`, and `workDateKey`.
- The plan excludes SQL/device sync, IP checks, notifications, attachments, generic approval configuration, and payroll because no Phase 2 endpoint requires them.
- Every write that changes balance or request state is explicitly transaction/condition protected.
