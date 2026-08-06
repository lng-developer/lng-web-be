# HR Batch 1 Edge Cases Design

## Goal

Harden Employee Profile and Staff Provisioning edge cases without changing the approved predictable provisioning password behavior.

## Scope

- Keep `createProvisionedAccount()` password `123456` unchanged.
- Provisioned staff always starts with HR status `PROBATION`; the provisioning API no longer accepts a caller-selected status.
- Initialize the annual leave balance for the UTC year of `startDate`.
- Validate avatar content signatures for JPEG, PNG, and WebP in addition to MIME type, extension, and size.
- Discard a newly stored avatar when profile persistence fails, and discard the previous avatar after a successful replacement.
- Treat Organization as the membership source of truth. Team changes made through HR must update the active Team Membership in the same MongoDB transaction as the profile update.
- Validate related dates so an end date cannot precede its corresponding start date.
- Make repeated profile delete and restore requests no-ops and avoid duplicate mutation audit events.

## Data Flow

### Staff provisioning

Validated request -> resolve active department/team -> authorize target scope -> create Auth account and assignments -> create `PROBATION` HR profile -> sync Team Membership -> initialize annual leave balance for `startDate` year -> required audit -> commit transaction.

### Profile organization update

Load current profile -> authorize current scope -> resolve and authorize destination scope -> transactionally update profile -> sync destination Team Membership when `teamId` changes -> write audit -> commit.

Changing only `departmentId` while retaining a team must still pass the existing rule that the team belongs to that department. Clearing `teamId` deactivates the account's active Team Membership through a minimal Organization public port backed by the existing repository operation.

### Avatar replacement

Validate metadata and file signature -> store new Media asset -> update profile reference -> discard old unattached asset. If profile update fails, discard the new unattached asset and preserve the old reference.

## Validation Rules

- Provisioning status is always `PROBATION` and unknown `status` input is rejected rather than silently honored.
- `probationEndDate >= startDate` when both exist.
- `endDate >= startDate` when both exist.
- `contractEndDate >= contractStartDate` when both exist.
- JPEG accepts its standard SOI signature, PNG its eight-byte signature, and WebP requires `RIFF` plus `WEBP` markers.

## Error And Idempotency Rules

- Invalid dates or avatar bytes return the existing `400 VALIDATION_ERROR` contract.
- Media cleanup is best-effort only through `media.public.discardUnattachedAsset`; the original business error remains authoritative.
- Deleting an already deleted profile and restoring an active profile return the current profile without another mutation or audit event.
- Existing duplicate key errors remain `409 CONFLICT_ERROR`.

## Testing

- Validator tests cover fixed provisioning status and each invalid date relationship.
- Employee Profile service tests cover spoofed image bytes, failed-upload cleanup, old-avatar cleanup, transactional team synchronization, and idempotent delete/restore.
- Staff Provisioning tests cover `PROBATION` persistence and leave-balance year derived from `startDate`.
- During implementation run only changed test files; after Batch 1 run the existing 12-suite Batch 1 command once.

## Out Of Scope

- Replacing the provisioning password flow.
- Reworking employee lifecycle rules outside initial provisioning.
- Running the complete repository test suite after every file change.
