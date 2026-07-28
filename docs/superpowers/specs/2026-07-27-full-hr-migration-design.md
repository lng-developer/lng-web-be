# Full HR Migration into POD — Design Specification

**Date:** 2026-07-27

**Status:** Approved

**Source backend:** `C:\lng_system\lng-hr\lng-hr-be`

**Target backend:** `C:\lng_system\lng-web\lng-web-be`

**Target frontend:** `C:\lng_system\lng-web\lng-web-fe`

## 1. Decision

Replace the standalone HR backend with the POD backend. Preserve the current
HR system's business behavior, calculations, lifecycle transitions, and edge
cases while adopting the POD modular-monolith boundaries, shared Auth/RBAC,
shared Organization data, shared Audit evidence, one MongoDB database, and new
HTTP contracts under `/api/hr/*`.

The standalone HR backend remains the operational source of truth during the
migration and for at least one shadow payroll period. It is then frozen,
delta-migrated, retained read-only for the tested rollback window, and shut
down completely.

## 2. Goals

1. Preserve 100% of the observable HR behavior currently relied on by users.
2. Move employee operations, scheduling, holidays, attendance, leave,
   overtime, payroll, payroll adjustments, announcements, notifications, and
   SQL attendance ingestion into the POD system.
3. Use POD Auth/RBAC and Organization as the only account, permission,
   department, team, and membership sources of truth.
4. Store migrated HR business data in the POD MongoDB database.
5. Replace the old HR frontend with redesigned HR pages inside `lng-web-fe`.
6. Prove payroll parity on real operational inputs before cutover.
7. Shut down the old API, workers, schedules, and secrets after a successful
   cutover.

## 3. Non-goals

- Do not retain compatibility with the old `/api/payrolls`,
  `/api/attendances`, or other standalone HR URLs.
- Do not copy the standalone app, server bootstrap, middleware stack, or auth
  models into the POD repository.
- Do not redesign payroll formulas, approval rules, attendance precedence, or
  accrual policies during the migration.
- Do not introduce bidirectional synchronization or permanent dual writes.
- Do not replace SQL Server as the upstream source of raw attendance punches.
- Do not add speculative HR features that are absent from the working system.

## 4. Current State

The POD backend already mounts an HR module at `/api/hr` and implements:

- employee profiles;
- work locations, shifts, assignments, and calendar overrides;
- attendance and self check-in/check-out;
- leave balances and leave requests;
- overtime requests;
- repository, DTO, validator, service, route, public-port, migration, readiness,
  and test layers.

The POD frontend already provides an HR workspace with permission-aware routes,
sidebar context, and pages for People, Schedule, Attendance, My Time, and the
request inbox. It already calls `/api/hr/*` through the shared API client.

The standalone HR backend additionally owns payroll, payroll adjustments,
holiday administration, Saturday rotations, announcements, notifications,
payroll email jobs, office-network/system settings, SQL Server attendance
ingestion, reconciliation/repair flows, dashboards, and their established
business behavior.

## 5. Architectural Boundaries

### 5.1 Existing modules to reuse

| Concern | Owner | Migration rule |
|---|---|---|
| Login, accounts, sessions, roles, permissions | `auth` | Map HR employees to POD accounts; do not port HR auth models |
| Departments, teams, memberships | `organization` | Map old identifiers to existing or migrated organization records |
| Immutable lifecycle evidence | `audit` | Record HR approvals, manual edits, reconciliation, finalize, and payment events |
| Employee and HR operations | `hr` | Own all HR business state and calculations |
| SQL attendance ingestion | `integration` | Own connection adapter, import cursor, batch retry, and scheduling only |
| Cross-domain inbox and delivery | new `notification` module | Own notification records, read state, and delivery jobs |

All cross-module calls go through the target module's `public.js`. Controllers
perform HTTP parsing and response handling only; services orchestrate business
rules; repositories own Mongoose access; DTOs shape every response.

### 5.2 HR-owned domains

The existing `src/modules/hr` boundary expands to own:

- employee profile and employment status;
- work location, shift, assignment, calendar override, holiday, and Saturday
  rotation;
- normalized attendance day, manual attendance edit, reconciliation result,
  and attendance-related policy resolution;
- leave request, approval, cancellation/refund, balance, accrual, reset, and
  carry-over;
- overtime request and approval lifecycle;
- payroll run, per-employee payroll result, adjustment, calculation snapshot,
  finalize/payment lifecycle, payslip data, and payroll email request;
- HR dashboard read models;
- HR announcements and their attachment references.

Announcement remains in HR because its content and authorization are HR-only.
Delivery and per-recipient notification state belong to `notification`.

### 5.3 Integration-owned SQL ingestion

SQL Server remains the upstream source for raw clock punches. The Integration
module owns:

- SQL client configuration and health checks;
- watermark/cursor and sync-batch evidence;
- lookback window, batching, idempotency, retry, and worker scheduling;
- normalization from SQL rows into the HR public-port input contract.

Integration must not calculate workdays, leave effects, overtime, or payroll.
It calls `hr.public.importAttendancePunches()` and records the returned result.
Credentials remain environment-managed secrets; they are not stored in MongoDB
or returned by APIs.

### 5.4 Notification boundary

`notification` is a standalone technical/business-support module because its
inbox and delivery behavior is shared by leave, overtime, payroll,
announcements, and future POD domains. It owns notification persistence,
recipient inbox queries, unread counts, read state, delivery status, bounded
delivery retry, controllers, DTOs, repositories, routes, and `public.js`.

The originating domain remains responsible for deciding when a notification is
required, selecting recipients through authorized public data, and constructing
the domain-specific type, title, message, and related-resource link. HR calls a
small notification public port; it never imports notification models or
services. Notification does not query HR internals to reconstruct business
meaning.

Creating the inbox record is attempted after the HR state transition commits.
A notification persistence or delivery failure never rolls back an approved
leave, finalized payroll, or other completed HR transition. The failure is
returned as an operational result, logged with correlation data, and recorded
for controlled retry. Delivery retry is idempotent and must not create duplicate
inbox records.

The initial POD frontend reads `/api/notifications` with bounded TanStack Query
polling. Socket.IO is not added during migration; transport-level realtime is
not required for inbox, unread-count, mark-read, recipient, or message parity.
Realtime delivery can be added later only if measured latency requirements
justify the extra runtime and connection lifecycle.

## 6. Behavioral Parity Contract

"100% parity" means the POD implementation produces the same observable
business outcome from the same valid source state. It covers:

- validation and rejection conditions;
- attendance precedence, including manual edits, employment dates, Sunday/rest
  days, paid holidays, paid/unpaid leave, missing punches, and overtime;
- shift and Saturday-rotation resolution;
- leave balance accrual, reset, carry-over, refund, cancellation, and approval
  effects;
- overtime request and approval effects;
- payroll inputs, formulas, rounding, allowances, deductions, adjustments,
  gross, net, and per-employee breakdown;
- payroll statuses and allowed transitions, including calculate, finalize,
  payment, deletion/reversal where currently supported, and payslip/email
  behavior;
- notification recipients and announcement visibility;
- authorization intent, remapped to POD permission codes and scopes;
- audit-relevant actor, timestamp, reason, and before/after state.

Parity does not require identical MongoDB schemas, internal function names,
response envelopes, URLs, or implementation bugs that are not part of an
accepted workflow. Any intentional outcome difference discovered during
characterization requires an explicit design amendment before implementation.

The standalone tests and sanitized production-shaped fixtures become
characterization evidence. New POD tests assert the same outcomes through the
new domain services and `/api/hr/*` contracts.

## 7. HTTP and Authorization Contract

The public API uses these resource groups:

```text
/api/hr/employee-profiles
/api/hr/work-locations
/api/hr/shifts
/api/hr/shift-assignments
/api/hr/calendar-overrides
/api/hr/holidays
/api/hr/saturday-rotations
/api/hr/attendance
/api/hr/leave-balances
/api/hr/leave-requests
/api/hr/overtime-requests
/api/hr/payrolls
/api/hr/payroll-adjustments
/api/hr/announcements
/api/hr/dashboard
/api/hr/integrations/sql-attendance
/api/notifications
```

Resource and action routes follow the current POD style rather than old URL
compatibility. Payroll actions are explicit subresources/actions such as
preview/calculate, finalize, mark-paid, and email. Mutating payroll actions use
idempotency or current-state guards where replay could otherwise duplicate a
financial effect.

Permissions are grouped by business capability, with separate read, write,
approve/manage, finalize, pay, and integration-management powers where the
operation has materially different risk. Route middleware checks POD RBAC.
Response DTOs return server-computed capabilities for record-specific actions;
the frontend never branches on role names.

## 8. Data Migration

### 8.1 Identity mapping

Migration starts with deterministic mapping tables for:

- old account to POD account;
- old employee to HR employee profile;
- old department/team to Organization identifiers;
- old shift/location references to HR identifiers.

No dependent record is applied when its required identity mapping is missing.
Dry-run output reports the exact record, reason, and missing reference.

### 8.2 Migration behavior

Migration scripts must:

- identify source and target database names before apply;
- default to dry-run;
- be idempotent using stable source identifiers;
- preserve original business timestamps and legacy identifiers for traceability;
- report read, mapped, inserted, updated, unchanged, skipped, and failed counts;
- validate references and aggregate totals after each domain;
- support a bounded delta run after the old backend is frozen;
- never delete source data.

The migration order is identity/organization mapping, employee profiles,
schedule/calendar/holiday data, attendance, leave balances and requests,
overtime, payroll adjustments, payroll runs/results, announcements, and
notification/read-state data.

Large binary attachments are copied through the existing media/storage
mechanism and referenced from DTO-owned records; absolute source paths are not
persisted as application contracts.

## 9. Payroll Shadowing and Cutover

### 9.1 Shadow periods

Run one complete shadow payroll period. Run a second period when the first has
any mismatch or does not exercise every active pay policy and employee type.
For each shadow period:

1. The old backend remains the write authority.
2. POD receives the same normalized employee, calendar, attendance, leave,
   overtime, and adjustment inputs.
3. POD calculates a shadow payroll without sending email, notifications, or
   payment-state effects.
4. A comparison report evaluates each employee and period for workdays, leave,
   overtime, allowance, deduction, gross, net, rounding, and status.
5. Every mismatch is resolved at its root cause and rerun; values are not
   manually edited merely to make totals match.

### 9.2 Cutover gates

Cutover is allowed only when all gates pass:

- two consecutive migration runs demonstrate idempotency;
- all required account, employee, department, team, and schedule references map;
- attendance, leave, and overtime reconciliation is clean;
- shadow payroll is identical for every employee, or each approved exception
  is recorded before cutover;
- the POD SQL worker is caught up to the agreed source watermark;
- API authorization, frontend critical flows, email/notification suppression,
  and final delivery smoke tests pass;
- backup, restore, and rollback procedures have been rehearsed.

### 9.3 Cutover sequence

1. Stop HR writes and workers; place the old UI/API in read-only maintenance
   mode.
2. Back up the standalone MongoDB data and record the SQL watermark.
3. Run the final delta migration.
4. Verify document counts, reference integrity, payroll aggregates, and sample
   employee histories.
5. Enable POD SQL ingestion, scheduled HR jobs, new frontend routes, and real
   notification/email delivery.
6. Execute authentication, attendance, leave/OT, payroll, payslip, announcement,
   and worker smoke tests.
7. Keep the old backend read-only for seven calendar days as an audit reference.
8. Stop its processes and revoke old JWT, database, SQL, email, and delivery
   secrets after the seven-day reference window closes.

Rollback to the old backend is permitted only inside the maintenance window,
after the final delta migration and before POD HR writes are reopened. Once POD
accepts the first production HR write, recovery is forward-only. The two systems
are never allowed to remain concurrent write authorities.

## 10. Frontend Design

Extend the existing HR workspace in `lng-web-fe`; do not create another app,
layout, auth store, API client, or design system.

Navigation groups:

- **My HR:** profile, attendance, leave/overtime requests, payslips;
- **People & Time:** employees, schedules, attendance, request approvals,
  holidays;
- **Payroll:** payroll periods, adjustments, reconciliation;
- **Communication:** announcements;
- **Configuration:** work locations and SQL attendance status for authorized
  operators.

The header notification control uses `/api/notifications` for inbox and unread
state. Sidebar items are permission-filtered. Record actions use backend
capabilities rather than role-name inference.

The UI reuses MUI, TanStack Query, React Hook Form, Zod, the shared API client,
and existing operation shells/tables. Dense operational pages lead with totals,
exceptions, and actionable records; calculation detail, raw punches, audit
history, and migration evidence open in drawers. Finalize and mark-paid require
a preview, explicit confirmation, permission checks, and per-record results.

## 11. Error Handling and Operational Safety

- Expected failures use stable error codes and the global error middleware.
- Responses include a correlation identifier for worker, payroll, and migration
  investigations.
- Read requests may use bounded retry; payroll finalize and mark-paid never
  auto-retry in the frontend.
- SQL imports and migrations retry only through idempotent batch operations.
- Partial bulk results identify each succeeded and failed record and are never
  presented as full success.
- Shadow mode suppresses external emails and notifications while preserving
  comparison evidence.
- A notification persistence or delivery failure is visible to operations and
  retryable, but never reverses the committed originating HR transition.
- Notification retry uses a stable deduplication key so replay cannot create a
  second recipient inbox record.
- No fallback reads from the old database are allowed after cutover.
- Logs must not expose salaries, tokens, SQL credentials, or private connection
  strings.

## 12. Verification Strategy

1. **Characterization:** run the old domain logic against sanitized,
   production-shaped fixtures and capture accepted outcomes.
2. **Domain tests:** cover attendance, leave, overtime, holiday, rotation,
   payroll, adjustment, and notification edge cases.
3. **Architecture tests:** enforce public-port imports, repository-owned MongoDB
   access, lean reads, DTO responses, and module registration.
4. **Contract tests:** compare backend routes, frontend endpoint constants,
   permission requirements, capabilities, and stable error codes.
5. **Migration tests:** prove dry-run safety, idempotency, missing-reference
   reporting, preserved timestamps, and aggregate reconciliation.
6. **Worker tests:** prove cursor progression, lookback handling, duplicate
   suppression, bounded retry, and crash resume.
7. **Shadow tests:** produce per-employee and aggregate payroll diffs for each
   shadow period.
8. **Frontend tests:** cover permission visibility, critical forms and state
   transitions, partial failures, responsive layouts, and accessibility basics.
9. **Cutover rehearsal:** prove backup, delta migration, worker activation,
   smoke checks, and rollback before the production event.

Use the narrowest meaningful tests during each slice, then run HR, Auth,
Organization, Architecture, and broad suites when shared behavior changes.

## 13. Delivery Slices

1. **Parity inventory and harness:** freeze the source behavior catalog and
   fixtures before changing domain logic.
2. **Foundation:** finish identity mapping, employee/schedule parity, holidays,
   rotations, and settings needed by time resolution.
3. **Attendance ingestion:** port SQL adapter/worker, reconciliation, imports,
   and all attendance writer precedence.
4. **Leave and overtime:** port balances, accrual jobs, lifecycle actions,
   attachments, and attendance effects.
5. **Payroll:** port adjustments, calculation, snapshots, lifecycle, payslips,
   and email jobs.
6. **Communication and dashboards:** port notifications, announcements, and HR
   operational read models.
7. **Frontend:** release redesigned pages behind permissions as each backend
   slice reaches parity.
8. **Shadow and cutover:** complete one or two payroll comparisons, rehearse,
   freeze, migrate the delta, switch workers/UI, and retire the old backend.

Each slice must pass its parity and migration gates before the next dependent
slice becomes a production write path.

## 14. Acceptance Criteria

1. Every active standalone HR route and scheduled behavior has a documented
   disposition: replaced, reused from POD, or intentionally retired with
   approval.
2. The new system uses only POD Auth/RBAC and Organization identities.
3. All production HR UI calls use the new POD contracts; no request proxies to
   the standalone backend.
4. SQL attendance ingestion is idempotent and produces the same resolved
   attendance outcomes as the old system.
5. Leave, overtime, holiday, and rotation workflows match accepted old-system
   outcomes and update attendance consistently.
6. Payroll comparisons match per employee and in aggregate for the approved
   shadow period or periods.
7. Finalize, mark-paid, payslip, email, announcement, and notification behavior
   is permission-protected, audited, and parity-tested.
8. Migration dry-run, apply, repeated apply, and final delta checks pass without
   destructive source operations.
9. `lng-web-fe` provides responsive, permission-aware HR workflows without a
   second application shell.
10. The old backend and its workers are stopped, its secrets revoked, and the
    POD system remains the sole write authority after the rollback window.
