# HR Batch 7 Payroll Mutation Reliability Design

## Goal

Make payroll financial state and its audit evidence atomic while keeping user notifications from turning committed mutations into apparent failures.

## Scope

- Finalize payroll run, results, and audit in one transaction.
- Mark each payroll result paid with its audit in one transaction.
- Send finalization and paid notifications after commit as best-effort effects.
- Preserve batch mark-paid partial outcomes and optimistic versions.

## Finalization

The service owns one MongoDB transaction containing the existing conditional `DRAFT -> FINALIZED` transition and the `FINALIZED` audit. Repository finalization accepts an existing session and does not start a nested transaction.

If transition or audit fails, run and results remain `DRAFT`, so the same `expectedVersion` can be retried. Notifications are sent only after commit. A notification failure is logged and does not change the successful API response.

## Mark Paid

Each requested Payroll Result is processed independently in its own transaction:

1. Conditionally transition `FINALIZED -> PAID` at `expectedVersion`.
2. Record the result `PAID` audit using the same session.
3. Commit that result.

An audit failure rolls back that result and produces a failed outcome while processing continues for other IDs. Existing `NOT_FOUND`, `ALREADY_PAID`, `STALE_VERSION`, and `INVALID_STATE` classifications remain unchanged. Successful result notifications run after that result commits and are best effort.

After all result attempts, the existing run-completion check moves the run to `PAID` only when no non-paid result remains.

## Notification Failure

Notification errors use the shared logger with identifiers only. They do not throw from `finalizePayroll()` or `markPayrollPaid()` after the audited database mutation has committed. No salary amounts or employee details are logged.

## Testing

- Lifecycle tests prove finalization audit failure rolls back run and results and allows retry.
- Lifecycle tests prove finalization notification failure leaves the run finalized and returns success.
- Lifecycle tests prove paid audit failure rolls back only that result and the batch continues.
- Lifecycle tests prove paid notification failure leaves the result paid and does not fail its outcome.
- Existing stale, concurrent, immutable snapshot, and mixed-result tests remain green.
- During implementation run changed payroll tests only. At the Batch 7 gate run `npx jest src/test/hr --runInBand --silent`; do not run the full repository suite.

## Out Of Scope

- Outbox, queue, notification retry storage, or email worker changes.
- Payroll formulas, adjustments, DTOs, permissions, models, or indexes.
- Making the entire multi-result mark-paid request all-or-nothing.
