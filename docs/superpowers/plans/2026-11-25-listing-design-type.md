# Listing design type

Approved scope: choose Auto (null), NORMAL or CUSTOM_IMAGE when creating/editing a listing. New production tasks inherit explicit configuration with source LISTING. Existing AUTO/MANUAL tasks retain their existing behavior; LISTING tasks retain their creation-time type. No backfill or production data edits.

Implementation:
- Add nullable catalog schema, validator, patch allowlist and DTO field.
- Read listing via existing catalog public port; snapshot type only on task creation.
- Require a buyer-image file check for listing-configured custom tasks; preserve mapped assets and recover when a missing template/image arrives.
- Add localized listing editor field and API types.

Verification: catalog model/service, production service regression tests; architecture tests; editor UI tests including select/clear; FE typecheck, lint and build.

Review: fixed loss of acceptedFieldKeys mapping for optional slots and removal of empty generated fallback when real template slots arrive. No migration, new dependency or new public port.
