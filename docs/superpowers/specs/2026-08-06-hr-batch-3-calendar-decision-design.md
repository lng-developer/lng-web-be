# HR Batch 3 Calendar Decision Edge Cases Design

## Goal

Make Attendance, Leave, and Overtime use one canonical calendar decision while preserving historical snapshots.

## Current Problem

The HR module currently has two calendar paths:

- `scheduleResolver` applies `CalendarOverride` and is consumed directly by Leave and Overtime.
- `calendarPolicy` adds Holiday and Saturday Rotation data for Attendance imports.

The same employee and date can therefore be treated differently across HR workflows.

## Canonical Decision

`scheduleResolver.resolveWorkContext()` becomes the single source of truth for the effective calendar status. It resolves applicable records in this order:

1. Profile Calendar Override.
2. Team Calendar Override.
3. Department Calendar Override.
4. Work Location Calendar Override.
5. Global Calendar Override.
6. Applicable Holiday.
7. Saturday Rotation off.
8. Shift `workdays`.

The first applicable decision wins. A Calendar Override with `WORKING_DAY` may therefore open a workday even when a lower-priority Holiday would close it.

## Decision Mapping

- Calendar Override `WORKING_DAY` -> `WORKING_DAY`.
- Calendar Override `HOLIDAY` -> `HOLIDAY`.
- Calendar Override `REST_DAY` -> `REST_DAY`.
- Holiday with `isWorkDay: true` -> `WORKING_DAY`.
- Holiday with `isWorkDay: false` -> `HOLIDAY`.
- Applicable Saturday Rotation off -> `REST_DAY`.
- Otherwise Shift `workdays` determines `WORKING_DAY` or `REST_DAY`.

The resolver returns the selected source in its snapshot. Existing Calendar Override snapshot fields remain compatible. Holiday and rotation evidence is added only where required to explain the selected decision; unrelated or lower-priority candidates are not persisted.

## Consumer Flow

Employee and date -> effective assignment -> active Shift and Work Location -> applicable Calendar Overrides, Holiday, and Rotation -> precedence selection -> one work-context snapshot -> Attendance, Leave, and Overtime.

`calendarPolicy.resolveCalendarPolicy()` delegates its schedule decision to the canonical resolver. It must not independently reinterpret Holiday or Rotation state into another attendance result.

## Write Integrity

- Calendar Override and Holiday updates compare only normalized fields supplied by the request.
- An unchanged update returns the current DTO without persistence or mutation audit.
- Department and Team scopes must resolve to active Organization records.
- Profile and Work Location scopes must resolve to active HR records.
- Duplicate active Calendar Overrides continue to rely on the existing unique index and map to `409 CONFLICT_ERROR`.
- Duplicate Holiday behavior remains `409 CONFLICT_ERROR`.

## Historical Safety

Existing Attendance, Leave, Overtime, and Payroll snapshots are immutable inputs and are not recalculated by this batch. New records use the canonical resolver. Editing current calendar policy affects only future resolutions or workflows that have not yet persisted a snapshot.

## Error Contract

- Missing scope targets return `404 RESOURCE_NOT_FOUND`.
- Inactive scope targets return `409 CONFLICT_ERROR`.
- Invalid scope combinations return `400 VALIDATION_ERROR`.
- Duplicate active policy records return `409 CONFLICT_ERROR`.
- Authorization remains enforced for both the current and destination scope during updates.

## Testing

- Resolver tests cover the complete precedence chain and decision mapping.
- Consumer characterization tests prove Attendance, Leave, and Overtime receive the same status for the same employee/date.
- Service tests cover inactive or missing scopes and no-op Calendar Override/Holiday updates.
- Persistence coverage verifies duplicate Calendar Override behavior remains race-safe.
- During implementation run only changed test files. At the Batch 3 gate run the HR suite. Run architecture tests only if a module boundary changes. Do not run the full repository suite until PR or merge preparation.

## Out Of Scope

- Migrating Holiday or Saturday Rotation records into Calendar Override.
- Removing existing Calendar Policy APIs or models.
- Recalculating historical snapshots.
- Shift or Work Location immutable versioning.
- Frontend changes.
