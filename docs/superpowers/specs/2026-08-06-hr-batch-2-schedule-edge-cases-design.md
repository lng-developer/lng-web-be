# HR Batch 2 Schedule Edge Cases Design

## Goal

Harden Work Location, Shift, and Shift Assignment data integrity without introducing schedule versioning in this batch.

## Scope

- A Shift with a fixed `workLocationId` may only be assigned with that same Work Location.
- A Shift without a fixed location may use any active Work Location selected by the assignment.
- Serialize assignment overlap checks per Employee Profile inside MongoDB transactions.
- Reject a Shift when `breakMinutes` is greater than or equal to its total duration.
- Reject an assignment that starts before the employee `startDate` or ends after the employee `endDate`.
- Treat unchanged Work Location, Shift, and Shift Assignment updates as no-ops without persistence or mutation audit.
- Keep Calendar Override behavior for Batch 3.

## Assignment Write Flow

Validate request -> load and authorize active profile -> load active Shift and Work Location -> verify Shift/Assignment location compatibility -> validate employment date range -> start transaction -> touch the Employee Profile schedule lock -> query active overlap -> create/update assignment -> commit -> write the existing best-effort schedule audit.

When an assignment changes profile, lock both the old and new profiles in stable ID order before checking overlap. This prevents deadlocks and concurrent write-skew.

## Profile Lock

Add an internal `scheduleMutationVersion` numeric field to Employee Profile. The HR repository exposes a transaction-only increment operation. It has no DTO/API representation and exists only to serialize schedule mutations for a profile.

## Validation Rules

- Fixed Shift location and Assignment location must have identical IDs.
- `breakMinutes < shiftDurationMinutes`.
- `effectiveFrom >= employee startDate` using UTC `YYYY-MM-DD` date keys.
- When the employee has `endDate`, a finite assignment must satisfy `effectiveTo <= endDate`.
- An open-ended assignment is rejected when the employee has an `endDate`.
- Existing `effectiveTo >= effectiveFrom` and maximum 960-minute Shift duration rules remain.

## No-op Rules

- Compare only fields supplied by the update payload after validator normalization.
- If all supplied values equal persisted values, return the current DTO.
- Do not call update repositories or record mutation audit for a no-op.
- Authorization and not-found checks still run before returning.

## Error Contract

- Location mismatch, employment-range violation, and invalid break duration return `400 VALIDATION_ERROR`.
- Assignment overlap remains `409 CONFLICT_ERROR`.
- Duplicate code behavior remains unchanged.

## Deferred Historical Integrity

Editing Shift time or Work Location timezone currently changes historical resolution. Correct support requires immutable schedule versions or snapshots consumed by Attendance and Payroll. This batch does not block or partially patch those edits because status-based workarounds still corrupt historical resolution.

## Testing

- Validator/service tests cover break duration, location compatibility, employment bounds, and no-op updates.
- Persistence tests use a replica set to prove two concurrent overlapping assignment writes cannot both commit.
- Repository tests verify the profile lock uses the caller transaction.
- During implementation run targeted tests; finish with Batch 2, HR, architecture, and one full repository suite.

## Out Of Scope

- Shift and Work Location versioning or historical snapshots.
- Calendar Policy and Calendar Override hardening.
- Attendance and Payroll changes.
