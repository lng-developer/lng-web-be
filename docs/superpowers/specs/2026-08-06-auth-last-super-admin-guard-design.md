# Last Super Admin Guard Design

## Goal

Prevent every administrative mutation from leaving the system without at least one active account holding an active global `SUPER_ADMIN` assignment.

## Protected mutations

- Changing a Super Admin account from `ACTIVE` to another status.
- Archiving a Super Admin account.
- Replacing account access so the account loses its global `SUPER_ADMIN` assignment.
- Updating, moving, or deactivating a global `SUPER_ADMIN` access assignment.

Mutations that do not remove effective Super Admin access remain unchanged, including no-op updates and changes when another active global Super Admin account exists.

## Consistency

The guard runs inside the existing MongoDB transaction. Before counting eligible Super Admin accounts, the mutation touches the protected `SUPER_ADMIN` role document in that transaction. Concurrent destructive mutations therefore contend on the same document; MongoDB retries or rejects one transaction, whose repeated guard observes the committed state.

An eligible survivor must satisfy all of these conditions:

- Account status is `ACTIVE`.
- Access assignment status is active.
- Assignment scope is global with a null scope ID.
- Assignment points to the system `SUPER_ADMIN` role.

## Error contract

Reject a mutation that would remove the last eligible Super Admin with HTTP `409`, error code `CONFLICT_ERROR`, and message `At least one active SUPER_ADMIN account is required`.

## Boundaries

- The service owns the invariant; controllers and validators remain unchanged.
- Repositories own the MongoDB lookup/count and role-document touch.
- No new model, collection, setting, or approval workflow is introduced.
- Existing authorization still determines who may attempt the mutation; this guard only preserves system recoverability.

## Verification

Regression tests must first fail against current behavior, then pass after implementation. They cover each protected mutation, no-op behavior, a surviving second Super Admin, and the shared transaction lock. Finish with the full Auth suite and architecture tests.
