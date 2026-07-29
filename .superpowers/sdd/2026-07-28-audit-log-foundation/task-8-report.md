# Task 8 Report: Remaining HR High-Risk Audit Gaps

## Status

`DONE_WITH_CONCERNS`

Task 8 coverage is implemented within the seven owned HR services and focused HR tests. No schema, repository, dependency, endpoint, module boundary, generic middleware, or Task 9 catalog change was added.

Concern: `npm test -- --runInBand` was attempted once without `--forceExit` and timed out after 304 seconds without returning a final Jest summary, matching the branch's documented open-handle behavior. The exact leftover npm -> cmd -> Jest process tree from that attempt was verified by PID/command line and terminated. Focused HR and architecture suites are green.

## Mutation Inventory And Coverage Ledger

| Service | Mutation/read inventory | Task 8 coverage |
| --- | --- | --- |
| `employeeProfile.service.js` | `createProfile`, `updateProfile`, `deleteProfile`, `restoreProfile`; `getProfile(..., { includeSensitive: true })` | Audited as `HR_EMPLOYEE_PROFILE_CREATED`, `UPDATED`, `DELETED`, `RESTORED`, and `SENSITIVE_READ`. Sensitive admin reads fail closed if Audit is unavailable. Ordinary directory/self reads are intentionally not audited. |
| `attendance.service.js` | `checkIn`, `checkOut`, `adjustAttendance`, `importAttendancePunches`; Leave reconciliation/reversal projections | Human mutations audited as ACCOUNT/HTTP. SQL batches audited as SYSTEM/IMPORT. Completed batch replay emits no new event. Leave projection writes remain subordinate to the transaction-scoped Leave event and are not duplicated centrally. |
| `schedule.service.js` | Work-location create/update; shift create/update; assignment create/update; calendar-override create/update | All eight mutations audited. Assignment/profile-scoped events use TEAM or DEPARTMENT scope; global configuration remains unscoped for global Audit readers. |
| `calendarPolicy.service.js` | Holiday create/update/delete/import; rotation generate/update/delete/team bulk-delete | All persisted mutations audited. Holiday imports use IMPORT source. Rotation generation emits one event per persisted rotation. Zero-row team deletion is a no-op with no event. Read/check/summary/template methods are intentionally not audited. |
| `leave.service.js` | Balance set/adjust/accrue/reset/carry-over; request create; attachment append; intermediate approve; reject/final approve/refund/cancel | Missing families added. Existing terminal events and domain histories are preserved. Intermediate approval uses its persisted approval level. Accrual and carry-over no-op retries emit no new event. Preview and ordinary reads remain unaudited. |
| `overtime.service.js` | Request create; intermediate/final approve; reject/cancel | Request creation and intermediate approval added; existing terminal events preserved. No overtime attachment model/service/route exists, so no endpoint was invented. Ordinary reads remain unaudited. |
| `announcement.service.js` | Create/update/delete; scheduled status publication; notification publication/reminder markers | Create/update/delete and scheduled publication audited. Scheduled publication is SYSTEM/SYSTEM. Notification delivery timestamps and reminder markers are intentionally not audited. |

## Action, Entity, Scope, Source, And Deduplication Rules

- Employee: `HR_EMPLOYEE_PROFILE`; TEAM then DEPARTMENT scope; ACCOUNT/HTTP; persisted ID plus persisted timestamp/version fallback. Sensitive-read events use a server-generated access identity because each exposure is independently auditable.
- Attendance: `HR_ATTENDANCE_DAILY` or `HR_ATTENDANCE_IMPORT_BATCH`; schedule TEAM/DEPARTMENT scope; ACCOUNT/HTTP or SYSTEM/IMPORT; persisted swipe/adjustment timestamps and batch outcome/count operation state.
- Schedule: `HR_WORK_LOCATION`, `HR_SHIFT`, `HR_SHIFT_ASSIGNMENT`, `HR_CALENDAR_OVERRIDE`; target scope where meaningful; ACCOUNT/HTTP; persisted timestamps/version fallback.
- Calendar: `HR_HOLIDAY`, `HR_SATURDAY_ROTATION`, `HR_SATURDAY_ROTATION_SET`; conservative single TEAM/DEPARTMENT scope only; ACCOUNT/HTTP or ACCOUNT/IMPORT; persisted entity identity/timestamps and hashes of persisted bulk-deleted IDs.
- Leave: `HR_LEAVE_BALANCE` and `HR_LEAVE_REQUEST`; requester/target TEAM/DEPARTMENT scope; ACCOUNT/HTTP; balance history length/time, attachment media-reference hash, approval level, terminal state, and canonical sorted refund date keys.
- Overtime: `HR_OVERTIME_REQUEST`; requester TEAM/DEPARTMENT scope; ACCOUNT/HTTP; request ID/status and approval level.
- Announcement: `HR_ANNOUNCEMENT`; one-department audience scope when exact, otherwise conservative unscoped access; ACCOUNT/HTTP or SYSTEM/SYSTEM; persisted create/update/publish/delete timestamps.

Client request IDs are not used as mutation identities.

## Files Changed

Production:

- `src/modules/hr/services/employeeProfile.service.js`
- `src/modules/hr/services/attendance.service.js`
- `src/modules/hr/services/schedule.service.js`
- `src/modules/hr/services/calendarPolicy.service.js`
- `src/modules/hr/services/leave.service.js`
- `src/modules/hr/services/overtime.service.js`
- `src/modules/hr/services/announcement.service.js`

Tests:

- `src/test/hr/services/employeeProfile.service.test.js`
- `src/test/hr/services/attendance.service.test.js`
- `src/test/hr/services/attendanceImport.service.test.js`
- `src/test/hr/services/schedule.service.test.js`
- `src/test/hr/services/calendarPolicy.service.test.js`
- `src/test/hr/services/leave.service.test.js`
- `src/test/hr/services/leave.lifecycle.test.js`
- `src/test/hr/services/overtime.service.test.js`
- `src/test/hr/services/announcement.service.test.js`

## RED Evidence

Initial command:

```text
npx jest src/test/hr/services/employeeProfile.service.test.js src/test/hr/services/attendance.service.test.js src/test/hr/services/attendanceImport.service.test.js src/test/hr/services/schedule.service.test.js src/test/hr/services/calendarPolicy.service.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js src/test/hr/services/announcement.service.test.js --runInBand
```

Observed: 8 failed suites, 15 failed tests, 106 passed. Expected audit assertions failed with zero calls/events for Employee, Attendance, Import, Schedule, Calendar, Leave, Overtime, and Announcement. Two tests first stopped on incomplete test fixtures (`Department not found` and missing shift times); fixtures were corrected without production changes.

Corrected RED confirmation:

```text
npx jest src/test/hr/services/employeeProfile.service.test.js src/test/hr/services/schedule.service.test.js --runInBand
```

Observed: 2 failed suites, 2 failed tests, 28 passed. Both failures were the expected empty Audit call lists.

## GREEN Evidence

Focused changed behavior:

```text
npx jest src/test/hr/services/employeeProfile.service.test.js src/test/hr/services/attendance.service.test.js src/test/hr/services/attendanceImport.service.test.js src/test/hr/services/schedule.service.test.js src/test/hr/services/calendarPolicy.service.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/leave.lifecycle.test.js src/test/hr/services/overtime.service.test.js src/test/hr/services/announcement.service.test.js --runInBand
```

Result: 9 suites passed, 137 tests passed.

All HR:

```text
npx jest src/test/hr --runInBand
```

Result: 48 suites passed, 372 tests passed.

Architecture:

```text
npm run test:architecture -- --runInBand
```

Result: 1 suite passed, 22 tests passed.

Static checks:

- `node -c` passed for all seven changed service files.
- `git diff --check` passed.

Full suite:

```text
npm test -- --runInBand
```

Result: incomplete; command timed out after 304 seconds without a final test summary. `--forceExit` was not used as a substitute.

## Transaction And Session Proof

- Final Leave approval calls `auditPublic.record(..., { session })` inside the existing Leave transaction after the request transition and balance/attendance writes.
- Intermediate Leave approval calls Audit with the same transaction session and an operation key containing the persisted approval level.
- Partial Leave refund and approved Leave cancellation call Audit with the same session before transaction commit.
- `leave.lifecycle.test.js` forces `auditPublic.record` to reject during approval and verifies the transaction rolls back all effects: request remains `PENDING`, `usedUnits` remains `0`, no attendance projection exists, and no Audit event exists.
- Non-transaction legacy HR mutations use best-effort Audit writes and log failures after the business write. Sensitive profile reads are the exception and fail closed.

## Sensitive-Data Proof

Tests serialize captured/persisted events and verify exclusion of:

- employee full name, phone numbers, address, DOB, and salary values;
- Leave reason text;
- attachment media IDs, filenames, MIME types, and contents;
- announcement title, body, attachment references, and target employee IDs;
- holiday names, notes, and rotation employee lists.

Audit metadata contains only required IDs, action/status/type fields, dates, counts, safe changed-field names, approval levels, and non-financial duration/unit summaries. Existing domain histories retain their current reason/actor snapshots unchanged.

## Self-Review

- Cross-module calls use `audit/public.js`; no module internals are imported.
- Preview-only calls, ordinary self reads, and notification markers remain unaudited.
- Existing Leave/Overtime terminal audit semantics and domain histories remain intact.
- Intermediate approvals and partial refunds use operation-specific keys.
- No client request ID is used for deduplication.
- Multi-scope events use conservative null scope rather than granting visibility through one incomplete scope.
- No new endpoint, overtime attachment feature, dependency, schema, repository, middleware, or shared abstraction was added.

## Commit

Commit message: `feat(hr): complete high-risk audit coverage`

Commit SHA: this report is part of the commit itself; the canonical SHA is recorded in the task handoff from `git rev-parse HEAD` because a commit cannot embed its own final hash.
