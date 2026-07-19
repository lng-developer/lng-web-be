# Task 3 Report: Scoped Time Queue Summaries

## Delivered

Leave, overtime, attendance, and shift-assignment list responses now return optional `summary` data:

```js
{ items, pagination, summary: { total, statusCounts } }
```

Each repository uses its existing complete filter, including caller-provided scope filters, for the paginated page, total, and every server-side status count. Counts never derive from page items. Status counts include only the statuses valid for each screen: request statuses for leave/overtime, attendance statuses for attendance, and active/suspended for assignments. No endpoint, frontend, order, or production code changed.

## TDD Evidence

1. RED: added four service contracts, including a scoped leave page with one item but a three-record summary. The focused service command failed exactly because `result.summary` was absent.
2. While checking repository coverage, the first aggregation approach exposed a MongoDB casting risk: scoped filters use string ObjectIds, while aggregation `$match` does not apply normal Mongoose query casting. Replaced it with status-specific `countDocuments` queries composed with the exact existing filter.
3. RED: extended the schedule repository test to require the same scoped filter in each status-count query; it failed because the status count queries did not yet exist.
4. GREEN:

```powershell
npx jest --runInBand src/test/hr/repositories/schedule.repository.test.js src/test/hr/repositories/overtime.repository.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js src/test/hr/services/attendance.service.test.js src/test/hr/services/schedule.service.test.js
```

Result: 6 suites, 78 tests passed. `git diff --check` and `node -c` for all eight changed production files also passed.

## Broader Verification

```powershell
npx jest --runInBand src/test/hr
```

Result: 25 suites / 170 tests passed. Five pre-existing HR route suites fail at module load because their Auth public-port mocks do not define `authorizeScopedPermission`; no route or Auth files were changed here.

## Commit Scope

Only the four HR list repositories, four corresponding services, their four service tests, the existing schedule repository query-contract test, and this report are staged for `feat(hr): add scoped time queue summaries`.

## P1 Follow-up: Attendance Repository Status Import

Added `src/test/hr/repositories/attendance.repository.test.js` to execute the attendance `list()` summary filter path. RED failed with `ReferenceError: hrAttendanceStatuses is not defined` at `attendance.repository.js:47`. GREEN was the same focused command passing after importing `hrAttendanceStatuses` from `../constants/hr.constants`.

```powershell
npx jest --runInBand src/test/hr/repositories/attendance.repository.test.js
```

Result: 1 suite / 1 test passed.
