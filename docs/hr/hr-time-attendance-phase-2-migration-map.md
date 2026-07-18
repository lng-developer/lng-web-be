# HR Time And Attendance Phase 2 Migration Map

## Source Mapping

| Legacy HR model | Portal HR model |
| --- | --- |
| `Employee` | `HrEmployeeProfile` |
| `Shift` | `HrShift` plus `HrShiftAssignment` |
| `Holiday`, `SaturdayRotation` | `HrCalendarOverride` |
| `Attendance` | `HrAttendanceDaily` |
| `Leave`, `LeaveBalance` | `HrLeaveRequest`, `HrLeaveBalance` |
| `Overtime` | `HrOvertimeRequest` |

`OfficeNetwork`, `AttendanceSyncLog`, and `Payroll` are not imported in Phase 2.

Production data migration requires a separate reviewed import plan after portal HR master data,
account links, organization scopes, work locations, shifts, and assignments exist.

## Deployment Prerequisites

Production disables Mongoose `autoIndex`. Run the readiness audit before enabling HR time routes:

```powershell
node src/modules/hr/scripts/auditHrTimeReadiness.js --as-of=2026-07-18 --timezone=Asia/Ho_Chi_Minh
```

`--as-of` is the operations date (`YYYY-MM-DD`). When omitted, the script derives the date in
`HR_OPERATIONS_TIMEZONE`, defaulting to `Asia/Ho_Chi_Minh`; it never uses the process-local date.

Resolve every active profile without an assignment effective today. The overlap audit separately
checks every `ACTIVE` assignment window, including past and future windows, so historical or
scheduled conflicts are not hidden by today's effective-date filter.

## Index Migration

The request conflict indexes depend on canonical arrays created by the Phase 2 services:

- `HrLeaveRequest.conflictKeys`: `<workDateKey>:MORNING|AFTERNOON`.
- `HrOvertimeRequest.conflictMinuteKeys`: absolute UTC epoch-minute values.

Before running the index script:

1. Inventory active `PENDING` and `APPROVED` requests missing either canonical field.
   The preflight rejects leave keys unless they exactly equal the valid snapshot dates expanded by
   the request portion (`MORNING`, `AFTERNOON`, or both for `FULL_DAY`). It rejects overtime keys
   unless they are nonnegative integer epoch minutes exactly covering
   `[plannedStartAt, plannedEndAt)` and matching `requestedMinutes`.
2. Prepare and review a separate one-off backfill using leave working-date snapshots and overtime
   `plannedStartAt`/`plannedEndAt`. Do not infer values from free text.
3. Validate that no active requests share the same `profileId + conflict key`.
4. Inspect existing collection indexes with `getIndexes()` and compare names/options with the
   current Mongoose schemas.
5. If an old index conflicts by name or options, schedule a reviewed maintenance window and drop
   only that confirmed old index manually.
6. Run the idempotent prerequisite:

```powershell
node src/modules/hr/scripts/ensureHrTimeIndexes.js
```

7. Before index creation, the script logs the exact connected Mongo `host`, `database`, and
   `port` when available. Verify those values match the approved production deployment target.
   The output never includes the Mongo URI, username, or password. The script is non-interactive;
   an incorrect target must be stopped by the operator and corrected in deployment configuration.
8. Verify the unique partial indexes for `profileId + conflictKeys` and
   `profileId + conflictMinuteKeys` exist and cover `PENDING`/`APPROVED` requests.

The script performs duplicate preflight checks before creating indexes. It does not update requests,
backfill canonical fields, or drop indexes. When duplicates exist, it fails before creating either
model's indexes.
