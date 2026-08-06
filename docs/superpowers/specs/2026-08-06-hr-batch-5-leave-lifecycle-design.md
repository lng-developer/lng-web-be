# HR Batch 5 Leave Lifecycle Edge Cases Design

## Goal

Keep leave balance, attendance projection, and request state consistent when approval, partial refund, and cancellation are retried or overlap.

## Scope

- Validate requested leave dates against the employee employment period.
- Re-read approved leave inside cancellation transactions.
- Refund only the units still active after any partial refunds.
- Preserve idempotent approval, refund, and cancellation retries.
- Cover overlapping refund and cancellation with persistence tests.

## Employment Boundary

A leave request may include only dates on or after `EmployeeProfile.startDate` and, when present, on or before `EmployeeProfile.endDate`. Creation, preview, and pending-request updates share `prepareRequest()`, so the validation belongs there once before schedule resolution.

Use UTC date keys derived from the stored employment dates. Requests outside the period return `400 VALIDATION_ERROR`. Existing terminal requests are not rewritten.

## Cancellation Transaction

Approved cancellation must not use the request snapshot read before the transaction. Inside the transaction it must:

1. Re-read the request.
2. Re-authorize against the persisted snapshot.
3. Return the persisted result when it is already `CANCELLED`.
4. Require the current state to be `APPROVED`.
5. Re-check that cancellation occurs before the first active leave date.
6. Sum units from the current `workingDateSnapshots`.
7. Reverse the current attendance projection, refund those remaining units, and transition to `CANCELLED` in the same transaction.

Partial refund already removes refunded snapshots and reduces `requestedUnits`; cancellation therefore refunds only the remaining active units.

## Concurrency And Idempotency

MongoDB transaction write conflicts and the existing conditional request transition remain the concurrency mechanism. No lock or new version field is added.

- Two cancellation attempts produce one balance refund and one terminal request.
- A refund racing cancellation cannot refund the same units twice.
- A transaction retry re-reads current request state instead of reusing stale data.
- An already-cancelled authorized retry returns the persisted request without balance or attendance writes.

## Testing

- Service tests cover employment start/end boundaries and the open-ended employment case.
- Lifecycle tests prove partial refund followed by cancellation returns only remaining units.
- Persistence tests run overlapping refund/cancellation attempts and verify one consistent terminal outcome, balance, and attendance projection.
- During implementation run changed tests only. At the Batch 5 gate run `npx jest src/test/hr --runInBand --silent`; do not run the full repository suite.

## Out Of Scope

- Leave accrual and carry-over policy changes.
- Cross-year leave requests.
- New models, indexes, APIs, locks, or frontend changes.
- Rewriting historical terminal leave requests.
