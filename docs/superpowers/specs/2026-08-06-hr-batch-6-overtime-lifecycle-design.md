# HR Batch 6 Overtime Lifecycle Edge Cases Design

## Goal

Keep overtime requests within the employee employment period and prevent approved historical overtime from being cancelled after work has begun.

## Scope

- Validate overtime work dates against employee employment dates.
- Allow approved cancellation only before `plannedStartAt`.
- Preserve pending cancellation and terminal retry behavior.
- Prove concurrent cancellation produces one terminal outcome.

## Employment Boundary

The overtime `workDateKey` must be on or after `EmployeeProfile.startDate` and, when present, on or before `EmployeeProfile.endDate`. The check belongs in `prepareRequest()` so create and update share one rule and invalid requests fail before schedule resolution.

Employment dates are converted to UTC date keys, matching the Leave boundary rule. Violations return `400 VALIDATION_ERROR`.

## Approved Cancellation Boundary

An authorized approver may cancel approved overtime only while the current instant is strictly before the persisted `plannedStartAt`. At or after that instant the service returns `409 CONFLICT_ERROR`.

The persisted request interval is authoritative. Pending requests remain cancellable by their requester without this time restriction. Already-cancelled retries remain authorized and idempotent.

Corrections after overtime begins belong to the existing attendance/payroll adjustment paths and are not introduced in this batch.

## Concurrency

The existing conditional transition from the observed status remains sufficient because cancellation changes only one Overtime Request document. Concurrent identical cancellations may race, but the loser re-reads the persisted request and returns the same `CANCELLED` result. No transaction, lock, or version field is added.

## Testing

- Service tests cover dates before employment, after employment, exact boundaries, and a null end date.
- Service tests cover approved cancellation immediately before and at `plannedStartAt`.
- Persistence tests run two cancellation attempts concurrently and verify one terminal request, one cancellation audit, and one notification.
- During implementation run changed tests only. At the Batch 6 gate run `npx jest tests/hr --runInBand --silent`; do not run the full repository suite.

## Out Of Scope

- Attendance or payroll adjustment changes.
- Recalculating historical overtime.
- New models, indexes, APIs, transactions, locks, or frontend changes.
