# Work Score Design

## Goal

Create one Shop-scoped scoring module for approved Design outputs and QC-passed Production Scale outputs, with deterministic recovery and immutable adjustment history.

## Ownership and boundaries

A new `workScore` module owns score persistence, score queries, summaries, adjustment history, and authorization for score reads and mutations.

- Design calls the Work Score public port after a submission is approved.
- Production calls the Work Score public port after QC passes.
- Work Score does not import Design or Production internals.
- Source modules send complete, validated snapshots through public commands.
- FE uses only Work Score HTTP contracts and never calculates points or scope.

The existing Design score implementation is migrated into Work Score. Legacy Design scoring routes remain temporary thin compatibility delegates for one release and contain no scoring or authorization logic.

## Score sources

### Design submission

One score is created for the single `approvedAssetId` selected from an approved submission.

- Source type: `DESIGN_SUBMISSION`.
- Worker: submission `submittedBy`.
- Source unit: submission id.
- Idempotency key: `DESIGN_SUBMISSION + designTaskId + submissionId + approvedAssetId`.
- Default points retain the current task type and priority rules.
- Reference, rejected, unselected, and unapproved files do not earn points.

### Production Scale

Each required scaled-output file check that passes QC creates one score.

- Source type: `PRODUCTION_SCALE`.
- Worker: `outputWorkerId` captured when the scaled output is attached.
- Source unit: production file-check id.
- Idempotency key: `PRODUCTION_SCALE + productionTaskId + fileCheckId + outputAssetId`.
- Default score: one point per QC-passed output.
- Three passing scaled-output slots produce three scores.
- Checks where scale is not required do not produce scores.
- QC rejection does not produce a score.
- A replacement output before QC Pass means only the final passing output is scored.
- If recovery discovers a previously scored output was replaced, the old score is system-voided and the passing replacement is scored.

Production file checks gain an `outputWorkerId` snapshot. Normal designer uploads attribute the assigned designer; trusted administrative uploads must explicitly preserve the assigned designer attribution. Reassignment after upload cannot transfer historical credit.

## Data model

`WorkScore` stores:

- `sourceType`: `DESIGN_SUBMISSION | PRODUCTION_SCALE`
- `sourceTaskId`, `sourceUnitId`, `assetId`
- `shopId`
- `workerId` and worker/team/department name snapshots
- source context snapshot: task type, priority, listing/order identifiers, SKU/title, slot key/label
- `basePoints`, `finalPoints`, `scoreLevel`
- `status`: `ACTIVE | VOIDED`
- rule snapshot and scoring timestamps
- `adjustments[]`
- Mongoose version for optimistic concurrency

Each adjustment is append-only and records:

- type: `OVERRIDE | VOID | SYSTEM_VOID`
- previous and next points, level, and status
- reason
- actor id
- timestamp

Current top-level fields represent the latest state. Adjustment history is the audit record and cannot be edited through application APIs.

Unique index:

`sourceType + sourceTaskId + sourceUnitId + assetId`.

## Existing data migration

The migration is idempotent and runs before the new module is enabled.

- Existing Design scores become `DESIGN_SUBMISSION`.
- Existing `taskId`, `submissionId`, and `designerId` map to the generalized source and worker fields.
- `shopId` and context snapshots are populated by joining the Design task.
- Existing override metadata becomes an initial `OVERRIDE` adjustment.
- Existing void metadata becomes a `VOID` adjustment.
- Rows whose source task no longer exists are reported and left untouched for manual review.
- Dry-run reports eligible, migrated, skipped, and failed counts.
- Existing unique constraints remain effective until the generalized unique index is installed.

## Authorization

New permissions:

- `WORK_SCORES:READ`
- `WORK_SCORES:ADJUST`

Both support global and exact Shop scope.

- Global/scoped `WORK_SCORES:READ` can list, summarize, and view detail within its scope.
- Global/scoped `WORK_SCORES:ADJUST` can override or void within its scope.
- `DESIGN:WORK` can read only scores where `workerId` is the authenticated account and Shop scope permits access.
- Role names are never used for authorization.
- List, summary, detail, override, and void repeat authorization in the service after route checks.

## HTTP API

- `GET /api/work-scores`
- `GET /api/work-scores/summary`
- `GET /api/work-scores/:scoreId`
- `PATCH /api/work-scores/:scoreId/override`
- `PATCH /api/work-scores/:scoreId/void`

List filters:

- `search`
- `sourceType`
- `shopId`
- `workerId`
- `taskType`
- `scoreLevel`
- `scoreStatus=ACTIVE|VOIDED|ALL`
- `dateFrom`, `dateTo`
- pagination and sorting by `scoredAt`, `finalPoints`, or `updatedAt`

Summary returns total points/files and breakdowns by source type, worker, and task type using the same authorized filter.

Override requires `points`, optional `scoreLevel`, `reason`, and `expectedVersion`. Void requires `reason` and `expectedVersion`. Points must be finite and non-negative; reasons are trimmed to 2–500 characters. A stale version returns `409 CONFLICT`. A voided score cannot be overridden.

No public endpoint creates a score manually.

## Workflow and recovery

Design approval and Production QC Pass are authoritative business transitions. Score creation happens through idempotent Work Score public commands after those transitions.

If score creation fails:

- the primary transition still succeeds;
- response includes a safe warning code, `SCORE_CREATION_FAILED`;
- internal error details are logged without exposing storage paths or sensitive payloads;
- the operation is recoverable by backfill.

The backfill command:

- supports `--dry-run` and bounded batch size;
- scans approved Design submissions and QC-passed Production output checks;
- creates missing scores through the same public commands;
- detects replaced Scale outputs and system-voids obsolete scores;
- reports created, existing, voided, skipped, and failed counts;
- is safe to rerun.

## Frontend workspace

Add `/portal/work-scores`.

Summary cards:

- total points
- total scored files
- Design points
- Scale points

The table shows source, file/slot, listing or order context, worker, base/final points, status, and approval/QC time.

Filters mirror the API. The detail drawer shows source context, rule snapshot, and complete adjustment history. Users with `WORK_SCORES:ADJUST` receive icon actions for per-file override and void. Designer users can only see their own authorized scores. FE hides unavailable actions but BE remains authoritative.

FE uses backend-provided Media download URLs and does not generate previews or storage URLs.

## Error handling

- Page reads use shared inline feedback and retain filters.
- Mutation errors preserve entered reasons for retry.
- Duplicate scoring returns the existing score.
- Concurrent adjustment returns `409` and refreshes detail before retry.
- Missing or replaced source records are surfaced in backfill reports, not silently discarded.
- Scoring warnings never convert successful Design/Production transitions into client-visible failures.

## Verification

Backend tests cover:

- cross-Shop isolation for list, summary, detail, override, and void;
- self-only reads for `DESIGN:WORK`;
- all Design task types;
- three passing Scale slots creating exactly three scores;
- QC reject/rescale/pass behavior;
- retry and backfill idempotency;
- Design approval and Production QC succeeding during score failure;
- migration of active, overridden, and voided legacy rows;
- repeated overrides preserving immutable history;
- stale-version conflicts;
- route order, validation, architecture boundaries, and permission registry.

Frontend tests cover:

- route permissions;
- summary and list filters;
- own-score view;
- source/status presentation;
- history drawer;
- override/void availability and validation;
- conflict and read-error handling.

Release gates:

- Work Score, Design, Production, Auth/RBAC, migration, and architecture suites;
- FE unit/UI suites, lint, and production build;
- test database only for migration and backfill verification.
