# HR Batch 8 Payroll Adjustment Integrity Design

## Goal

Keep payroll adjustments, audit evidence, and DRAFT payroll calculations consistent while preserving finalized payroll as immutable history.

## Period Lock

- A period with no Payroll Run is open for adjustments.
- A `DRAFT` Payroll Run is open and its affected result must refresh in the same transaction.
- A `FINALIZED` or `PAID` Payroll Run rejects adjustment create, update, and cancel with `409 CONFLICT_ERROR`.
- Corrections for locked periods must be entered in a later open period; staff records the source period in the existing note.

The lock check must occur inside the mutation transaction. A DRAFT adjustment refresh writes the same Payroll Result that finalization transitions, so concurrent finalization and adjustment cannot both commit against stale state.

## Atomic Mutation Flow

Create, update, and cancel use one MongoDB transaction:

1. Read the current Payroll Run for the adjustment period.
2. Reject a locked period.
3. Apply the adjustment mutation using the existing optimistic version where applicable.
4. Record the adjustment audit with the same session.
5. If a DRAFT run exists, recalculate and replace the affected DRAFT Payroll Result using the same session.

Audit or refresh failure rolls back every write. A period without a run commits the adjustment and audit without attempting a refresh.

## Session Propagation

Existing repository calculation input queries accept an optional session. `refreshDraftPayrollResult()` passes that session through period lookup, calculation reads, and result replacement. No calculation formula changes.

## Validation

Adjustment `amount` must be a positive integer at both Joi and Mongoose boundaries. Zero-value adjustments return `400 VALIDATION_ERROR` and are not persisted.

## Concurrency And Idempotency

- Update/cancel continue to require `expectedVersion`.
- Concurrent update/cancel attempts allow one conditional mutation.
- Repeated cancellation returns the persisted `CANCELLED` result only when the period remains open; a locked period is immutable.
- Concurrent finalization and adjustment produce either the refreshed DRAFT result or the finalized pre-adjustment snapshot, never a committed adjustment omitted from a DRAFT calculation.

## Testing

- Lifecycle tests cover locked-period create/update/cancel.
- Audit and refresh failures roll back adjustment and Payroll Result.
- Concurrent finalization/adjustment leaves a consistent period state.
- Route/model tests reject zero amounts.
- During implementation run changed Payroll tests only. At the Batch 8 gate run `npx jest tests/hr --runInBand --silent`; do not run the full repository suite.

## Out Of Scope

- Review/approval workflow, reopened payroll, carry-forward automation, outbox, queue, new model, or new endpoint.
- Payroll formula or DTO changes.
