# Leader HR / Portal permission matrix rollout

Approved scope: retain LEADER as team HR, remove its Portal and calendar-write rights; retain Design business permissions; ensure SALES_LEADER supplies REPORTS:READ independently. Production migration separately approved and applied on 2026-10-16; application deployment remains separate.

## Production application

### Saturday rotation follow-up (not deployed)

Approved policy: LEADER manages Saturday rotation only within its assigned team; no general calendar/holiday write. Added `HR_SATURDAY_ROTATION:WRITE` to permission registry and LEADER matrix (now 9 permissions). Rotation routes/services accept this permission and retain exact-team, active-member and coverage validation for create/generate/update/delete/reset. Holiday routes/services remain unchanged.

Active FE route uses `ScheduleCalendar/useScheduleCalendar.tsx`; its rotation controls now use exact team access, while global calendar controls remain separate. HR navigation recognizes the new permission. The older unreferenced `pages/ScheduleCalendarPage.tsx` was not modified.

Deployment order: deliver BE/FE code, provision only the new Permission document, review a fresh leader-matrix dry-run, then apply the approved role/scoped-rule migration and invalidate caches. Do not run a broad production seed. No production permission or actual employee schedule was changed for this follow-up.

Verification: targeted BE 62 tests passed; FE HR unit 22 tests passed. Full-suite results must be checked separately; the preceding FE full run has CatalogListingWorkbenchPage and ImportJobPanel failures unrelated to the rotation files, plus the earlier Scale test version (subsequently fixed and targeted run passed).

### Scale assignment follow-up

User explicitly approved Design Leader assigning all Scale tasks. Added only `PRODUCTION:SCALE_ASSIGN` to DESIGN_LEADER (not PRODUCTION:WRITE). Applied to production `lng_web_be` in a transaction with audit operation `66ba8cd3-7f72-4550-811c-9b2bd2bea029`; read back role permissions and invalidated both assigned accounts. No scoped rules or explicit overrides existed for this role at apply time.

Live UI now shows Assign but row selection is disabled because FE still checks the task shop against team-scoped assignment permission. Local FE patch aligns row selection with the existing backend team Scale-assign policy. FE deployment and actual task assignment remain unverified; no real task was assigned.

- Fresh dry-run matched the approved scope: database `lng_web_be`, 2 roles + 2 scoped rules, 3 affected accounts, no blockers/warnings.
- Applied transaction and strict Redis invalidation successfully. Operation ID: `53fcfe8f-3629-42e0-97be-0031273bc8de`.
- Readback: zero remaining changes, 4 audit events for this operation, process exit 0.
- Used reviewed sources in a one-off Node process over SSH; no production repository files changed, no broad seed, no application restart/deployment.
- Browser end-to-end verification is not included. Server seed code must still be delivered before future broad seeding to avoid restoring the old defaults.

## Progress / decisions

- [x] Seed baseline: 11 tests passed before changes.
- [x] Red tests caught LEADER granting Portal/calendar-write, and missing migration implementation.
- [x] Narrow default LEADER to 8 HR read/approval permissions; display name Team Leader (HR).
- [x] Add REPORTS:READ to SALES_LEADER. Do not change DESIGN_LEADER or personal employee routes.
- [x] Migration defaults to dry-run. Normalize existing LEADER scoped rules; strip out-of-matrix custom/override permissions attached to LEADER while preserving explicit empty overrides. Preserve other-role assignments.
- [x] Refuse apply if active LEADER/SALES_LEADER assignments have non-team scope. Report explicit Sales overrides that suppress reports rather than bypassing them.
- [x] Atomic transaction + audit before/after; invalidate affected account caches after commit and on idempotent retry.
- [x] Live read-only dry-run: lng_web_be, 2 roles + 2 scoped rules change, 3 affected accounts, zero blockers/warnings. No assignments need modification in this snapshot.
- [x] Auth/Organization/architecture/leave/overtime regression: 47 suites passed, 461 tests passed, 12 skipped (before strict-cache follow-up).
- [x] Independent review found swallowed Redis invalidation errors. Added opt-in strict invalidation and explicit post-commit failure reporting; regression RED then GREEN, 76 tests passed across repository/manager/migration.
- [x] Full backend run: 418 suites / 3,467 tests passed; 3 suites / 23 tests skipped, exit 0. This run started before the strict-cache follow-up; the final cache changes were separately verified by the 76-test regression above. Jest reported a worker teardown warning; clean teardown is not verified.

Ruling: this implementation is the approved leader permission matrix, not the earlier full RBAC rewrite. Task-owned Listing visibility, Payroll scope gaps and FE navigation permission splits remain separate work; changing role definitions alone cannot fix those paths.

Review disposition: no other actionable findings. Operational Redis failure may leave stale rights until retry or the existing 300-second TTL; migration now exits with an explicit failure instead of claiming full success. Legacy invalidation callers retain best-effort behavior.

## Commands

Read-only preview (uses configured MONGODB_URI):

```sh
node src/modules/auth/scripts/migrateLeaderPermissionMatrix.js
```

Only after reviewing the printed target database and per-scope impacts, and receiving separate operational approval:

```sh
node src/modules/auth/scripts/migrateLeaderPermissionMatrix.js --apply --database=lng_web_be
```

Do not use a broad seed command as the production migration. Dry-run includes role/scoped-rule before/after values and assignment-level extras. Impacts union grants within each exact scope; they do not imply permissions from other/global scopes have been revoked.

## Safety / rollback

No accounts, memberships, passwords or role codes are deleted or changed. SUPER_ADMIN and unrelated roles are untouched. Expired/inactive LEADER extras are cleaned as well to avoid restoring broad rights on reactivation; only currently effective grants appear in the impact table.

Each changed document is recorded in an audit event with operationId, collection, before and after values. Any audit/write failure rolls back the transaction. If cache invalidation fails after commit, rerun the same command to retry invalidation; do not assume the database rolled back. For rollback after a successful apply, use those before values only after comparing current values with the recorded after values; never overwrite subsequent administrator edits. No automatic rollback command is provided.

Existing Sales/Design account rights beyond LEADER are preserved, including independently configured legacy permissions. The separate legacy TEAM_LEADER role is not silently removed or redefined.
