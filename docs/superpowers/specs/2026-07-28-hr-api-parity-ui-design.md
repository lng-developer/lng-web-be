# HR API Parity UI Design

**Date:** 2026-07-28

**Status:** Approved design, awaiting written-spec review

## Objective

Complete frontend coverage for every business route declared by the POD backend HR module while preserving the accepted legacy HR behavior. The completion target is 78 runtime-consumed routes out of the 79 routes in `src/modules/hr/routes/index.js`; `GET /api/hr/health` remains an operational endpoint without a user-facing control.

The existing `/api/hr/*` contract, POD Auth/RBAC, Organization data, MongoDB, MUI application shell, TanStack Query conventions, and feature boundaries remain authoritative.

## Current State

The backend HR router exposes 79 routes. Static tracing from mounted frontend pages and components currently classifies them as:

- 51 routes with a runtime frontend consumer.
- 6 routes represented by a frontend endpoint or hook but not consumed by runtime UI.
- 22 routes absent from frontend behavior, including the intentionally headless health route.

The two SQL attendance routes are already used by HR Settings but are owned by the Integration module and mounted below `/api/hr/integrations`; they are not part of the 79-route count.

## Scope Definition

Parity means 100% of business behavior, not a visible button for every technical endpoint. Business operations must be reachable through an appropriate workflow. Technical health checks remain headless. No generic API console will be added.

### In Scope

- Employee soft-delete and restore.
- Payroll preview, persisted payroll execution, email delivery, and payroll adjustment lifecycle.
- Leave preview, attachment references, partial refund, individual balance administration, and batch balance jobs.
- Holiday detail, templates, range queries, policy checks, yearly summary, bulk import, and Saturday rotation maintenance.
- HR dashboard.
- Announcement detail retrieval.
- Minimal backend DTO and capability changes required to prevent frontend business-rule inference.
- Contract, adapter, composition, focused backend, lint, and build verification.

### Out of Scope

- A UI for `GET /api/hr/health`.
- New HR routes, models, repositories, or persistence semantics.
- A generic HR API console.
- Role-name checks in frontend components.
- Automatic retry for business mutations.
- New dependencies, WebSocket behavior, or unrelated frontend redesign.

## Chosen Approach

Implement vertical slices. Each slice completes endpoint declaration, query or mutation hook, runtime component, focused tests, and reviewer gate before the next slice starts.

Rejected alternatives:

- Declaring every endpoint before adding UI would preserve dead hooks and provide false coverage.
- Placing all controls in one HR Admin page would weaken feature ownership, create a large permission-heavy component, and obscure normal workflows.

## Architecture

The frontend data path remains:

```text
Page or component
  -> feature query/mutation hook
  -> ENDPOINTS.HR
  -> backend validator and service
  -> DTO with server-computed capabilities
  -> targeted TanStack Query invalidation
```

Feature ownership remains:

- `hr-time`: employee lifecycle, leave workflows, leave balances, calendar, and rotations.
- `hr-payroll`: payroll execution, payslip email delivery, and payroll adjustments.
- `hr-communication`: announcement list, edit, and detail behavior.
- `hr-dashboard`: a small read-only dashboard feature.

Dialogs and drawers stay inside the owning feature. Existing shared operations-shell, table, dialog, form, snackbar, and query conventions are reused. No generic form or API abstraction is introduced.

## Backend Contract Adjustments

The backend business behavior remains unchanged. Only response metadata needed for safe UI behavior is added.

### Employee Profiles

Directory DTOs returned from `GET /api/hr/employee-profiles?includeDeleted=true` must expose:

- `isDeleted`
- `deletedAt`
- `capabilities.edit`
- `capabilities.delete`
- `capabilities.restore`

`delete` is true only for an accessible non-deleted profile with `HR_EMPLOYEES:WRITE`. `restore` is true only for an accessible deleted profile with the same permission. The frontend must not infer these actions from status or role names.

### Leave Requests

Leave request capabilities must additionally expose:

- `attach`: true only when the authenticated requester can append references to a pending request.
- `refund`: true only when the authenticated approver can partially refund an approved annual-leave request with at least two active working-date snapshots remaining.

Existing `view`, `approve`, `reject`, and `cancel` capabilities remain unchanged.

### Payroll Runs

Payroll run capabilities must additionally expose:

- `email`: true only for `FINALIZED` or `PAID` runs when the authenticated account has `HR_PAYROLL:WRITE`.

The ability to open the global run-payroll dialog continues to use the authenticated permission set because no existing run record owns that action.

## Frontend Workflows

### Slice 1: Employee Lifecycle and Payroll Execution

`PeoplePage` gains an Include deleted toggle backed directly by `includeDeleted=true`. Deleted rows remain listable alongside active rows, display a deleted state, and offer restore only when the DTO permits it. Active rows offer soft-delete only when permitted. Both actions require confirmation and invalidate employee directory and affected detail keys. The frontend does not apply a deleted-only filter after server pagination.

`PayrollRunsPage` gains a payroll dialog with month, year, optional profile selection, and explicit mode:

- Preview calls `POST /api/hr/payrolls/run` with `shadow: true` and renders non-persisted results.
- Run and persist calls the same endpoint with `shadow: false` after confirmation.

Email delivery is available only through `capabilities.email`. The accepted response must render `queued`, `reused`, and `skipped` counts rather than collapsing the result into a generic success message.

### Slice 2: Payroll Adjustments

Payroll administration gains an Adjustments tab or drawer using:

- `GET /api/hr/payroll-adjustments`
- `POST /api/hr/payroll-adjustments`
- `PATCH /api/hr/payroll-adjustments/:id`
- `DELETE /api/hr/payroll-adjustments/:id`

Filters cover employee, month, year, status, and type. Create and edit use `profileId`, period, `type`, `code`, `name`, integer VND `amount`, and optional `note`. Update and cancel send `expectedVersion` from the loaded row.

The UI displays `requiresReview` and `draftPayrollRefreshed` returned by mutations. A conflict keeps the dialog open, refetches the current row/list, and asks the user to review the new version.

### Slice 3: Leave Workflow and Balance Administration

Creating leave becomes a preview-confirm flow. The preview uses the exact create payload and shows requested units, working dates, balance impact, and overlaps before persistence.

The request drawer exposes:

- Attachment reference editing through `POST /leave-requests/:requestId/attachments` when `capabilities.attach` is true.
- Partial date refund through `POST /leave-requests/:requestId/refund` when `capabilities.refund` is true. At least one working date must remain; full reversal continues to use cancellation.

Employee detail gains leave-balance administration for employee, year, and type:

- Read current balance and history.
- Upsert entitlement and adjustment values with a reason.
- Apply a non-zero increment/decrement with a reason.

A separate permission-gated administration dialog performs accrual, reset, and carry-over jobs. It supports an optional employee subset and renders the exact `processed`, `changed`, and returned item evidence supplied by each backend response. A request-level failure is shown as an error; the frontend does not invent per-row partial results that the contract does not return.

### Slice 4: Calendar and Rotations

`SchedulePage` remains the owner of calendar policy. It gains:

- Holiday detail drawer.
- Template selection for holiday creation.
- Range-backed calendar view.
- Year summary.
- Bulk import of one to 100 validated items.
- Policy check preview while preparing calendar changes.
- Rotation edit.
- Delete-all rotations for a selected team, month, and year.

Destructive operations require explicit confirmation. Bulk results remain visible until dismissed and must show partial failures.

### Slice 5: Dashboard and Announcement Detail

A new `/hr/dashboard` route loads `GET /api/hr/dashboard` with an optional `dateKey`. It displays:

- Employee totals and active/probation/on-leave distribution.
- Attendance expected count, coverage rate, present, late, absent, leave, and missing checkout counts.
- Pending leave, pending overtime, total pending, and approved overtime for the selected date.

Announcement rows open a detail drawer backed by `GET /api/hr/announcements/:id`. Edit and delete behavior remains in the existing page.

## Permissions and Capability Rules

- Route and top-level creation controls use permission codes returned by Auth.
- Record actions use DTO capabilities.
- Components never compare role names.
- A denied action is not rendered. Backend authorization remains authoritative if state becomes stale.
- SQL attendance remains guarded by `HR_INTEGRATIONS:MANAGE` in the existing HR Settings page.

## Query and Mutation Behavior

- Read hooks use stable feature query keys and existing response unwrappers.
- List queries preserve URL-backed filters where their page already follows that convention.
- Mutations set `retry: false`.
- Success invalidates only the owning list/detail/summary keys and dependent payroll or balance keys when the backend reports a refresh.
- Dialogs cannot close while a mutation is pending.
- No optimistic write is used for payroll, balances, refunds, bulk jobs, or versioned adjustments.

## Error Handling

- HTTP 400 validation details map to the relevant form field when a path is available; otherwise they appear in the dialog-level alert.
- HTTP 403 leaves existing data visible, removes or disables the stale action after permission state refresh, and shows a concise authorization message.
- HTTP 409 preserves user input, refetches current server state, and requires review before retry.
- Batch responses display processed, skipped, and failed counts plus row-level safe messages when supplied.
- Unknown failures use the existing API error normalization and snackbar conventions without exposing stack traces or sensitive payroll data.

## Testing Strategy

Every behavior follows red-green-refactor.

Backend focused tests prove:

- Deleted directory rows expose mutually exclusive delete/restore capabilities.
- Leave attach/refund capabilities match the service's ownership, lifecycle, leave-type, and remaining-date rules.
- Payroll email capability matches permission and run status.
- Existing route authorization and DTO fields remain compatible.

Frontend tests prove:

- Every added endpoint has the correct method and path.
- Every new adapter preserves DTO fields and integer money values.
- Runtime pages/components consume every business hook; no HR hook remains declaration-only.
- Buttons and dialogs follow permission/capability, confirmation, pending, conflict, and partial-result behavior.
- The dashboard route and navigation are permission-filtered.

Verification broadens in this order:

1. Focused test for the current slice.
2. All backend HR tests when backend contract code changes.
3. All frontend tests.
4. Frontend lint.
5. Frontend production build.
6. Final endpoint-level static audit.

## Delivery Sequence

1. Backend capability contract.
2. Employee lifecycle and payroll execution.
3. Payroll adjustments.
4. Leave preview, attachments, refund, and balance administration.
5. Holiday and rotation administration.
6. Dashboard and announcement detail.
7. Full contract audit and broad verification.

Each slice is independently testable and receives an implementation review before the next slice begins.

## Completion Gate

The work is complete only when:

- 78 of 79 routes in `src/modules/hr/routes/index.js` have a runtime frontend consumer.
- `GET /api/hr/health` is the only route without UI behavior.
- No HR query or mutation hook is declaration-only.
- SQL attendance status and sync remain active in HR Settings.
- No frontend component checks a role name.
- Every sensitive mutation has confirmation, pending state, and no automatic retry.
- Focused backend tests, the complete frontend test suite, frontend lint, and frontend production build pass.
- A final endpoint-level report accounts for all 79 routes.
