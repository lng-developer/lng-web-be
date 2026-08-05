# Work Score Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Design-only scoring with one Shop-scoped Work Score module covering approved Design files and every QC-passed Production Scale output.

**Architecture:** `workScore` owns persistence, authorization, history, HTTP reads/mutations, migration, and recovery. Design and Production call idempotent public commands after their authoritative transitions and treat scoring failures as recoverable warnings.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest, MongoDB migration scripts.

## Global Constraints

- Preserve strict modular boundaries; Design and Production may import only `workScore/public.js`.
- No public endpoint may create scores manually.
- One Scale output file check QC Pass equals one point.
- All list, summary, detail, override, and void operations enforce global/exact-Shop scope in services.
- `DESIGN:WORK` reads are self-only.
- Adjustments are append-only and use optimistic concurrency.
- Primary Design approval and Production QC transitions remain successful if scoring fails.
- Migration and backfill must support dry-run, bounded batches, and test database verification.
- Create one backend implementation commit only after all backend tasks and checks pass.

---

### Task 1: Work Score model, constants, and idempotent repository

**Files:**
- Create: `src/modules/workScore/constants/workScore.constants.js`
- Create: `src/modules/workScore/models/workScore.model.js`
- Create: `src/modules/workScore/repositories/workScore.repository.js`
- Create: `src/test/workScore/repositories/workScore.repository.test.js`

**Interfaces:**
- Produces `workScoreSourceTypes`, `workScoreStatuses`, `workScoreAdjustmentTypes`, and `workScorePermissions`.
- Produces repository functions `upsertSourceScore(payload)`, `findById(id)`, `list(query)`, `summarize(query)`, and `adjust(id, expectedVersion, patch)`.

- [ ] Write repository tests proving the compound source key is idempotent, list/summary honor `shopId|shopIds|workerId`, and `adjust` rejects a stale `__v`.
- [ ] Run `npm test -- --runInBand src/test/workScore/repositories/workScore.repository.test.js`; expect module-not-found failure.
- [ ] Implement the schema fields and indexes from the approved spec. Use `findOneAndUpdate` with `$setOnInsert` for score creation and filter `{ _id, __v: expectedVersion }` plus `$inc: { __v: 1 }` for adjustments.
- [ ] Run the focused repository test; expect all assertions to pass.

### Task 2: Public scoring commands and immutable adjustment service

**Files:**
- Create: `src/modules/workScore/dtos/workScore.dto.js`
- Create: `src/modules/workScore/services/workScore.service.js`
- Create: `src/modules/workScore/public.js`
- Create: `src/test/workScore/services/workScore.service.test.js`

**Interfaces:**
- Produces:
  - `recordDesignSubmissionScore(input)`
  - `recordProductionScaleScores(input)`
  - `overrideScore(scoreId, { points, scoreLevel, reason, expectedVersion }, auth)`
  - `voidScore(scoreId, { reason, expectedVersion }, auth)`
- `recordProductionScaleScores` accepts `{ productionTaskId, shopId, contextSnapshot, outputs: [{ fileCheckId, assetId, workerId, scoredAt }] }`.

- [ ] Write failing tests for current Design point rules, one point per Scale output, three outputs creating three scores, repeated calls returning existing rows, multiple overrides appending history, void protection, and stale-version conflict.
- [ ] Run `npm test -- --runInBand src/test/workScore/services/workScore.service.test.js`; expect missing service failure.
- [ ] Implement snapshot validation, finite non-negative point validation, append-only adjustment patches, and public commands. Do not import Design or Production internals.
- [ ] Re-run the focused service test; expect pass.

### Task 3: Shop-scoped HTTP reads and mutations

**Files:**
- Create: `src/modules/workScore/validators/workScore.validator.js`
- Create: `src/modules/workScore/controllers/workScore.controller.js`
- Create: `src/modules/workScore/routes/index.js`
- Create: `src/modules/workScore/index.js`
- Modify: `src/modules/index.js`
- Create: `src/test/workScore/routes/index.test.js`
- Create: `src/test/workScore/services/workScore.authorization.test.js`

**Interfaces:**
- Produces the five approved `/api/work-scores` routes.
- Consumes `WORK_SCORES:READ`, `WORK_SCORES:ADJUST`, and self-read `DESIGN:WORK`.

- [ ] Write failing route tests for query normalization, reason/points/version validation, authentication, route order, and absence of a create endpoint.
- [ ] Write failing authorization tests covering global access, exact Shop access, cross-Shop denial, self-only `DESIGN:WORK`, and Shop checks for detail/override/void.
- [ ] Run `npm test -- --runInBand src/test/workScore`; expect missing routes/services.
- [ ] Implement a single service access-filter builder used by list and summary, plus explicit per-row Shop checks for detail and mutations. Return `409` when repository `adjust` cannot match the expected version.
- [ ] Mount the module at `/api/work-scores` through the central module registry.
- [ ] Re-run `npm test -- --runInBand src/test/workScore`; expect pass.

### Task 4: RBAC permission registry and seeds

**Files:**
- Modify: `src/modules/auth/scripts/seedRbac.js`
- Modify: `src/modules/auth/scripts/seedDemoUsers.js`
- Modify relevant permission registry/seed tests under `src/test/auth`

**Interfaces:**
- Registers `WORK_SCORES:READ` and `WORK_SCORES:ADJUST`.
- Grants read/adjust only to existing manager/admin capability sets; scale designers continue self-read through `DESIGN:WORK`.

- [ ] Add failing seed/permission tests asserting both permissions exist and are assignable at Shop scope without relying on role-name checks.
- [ ] Run the focused Auth seed tests; expect missing permission failures.
- [ ] Add permissions to the canonical registry and appropriate demo roles. Do not grant `WORK_SCORES:ADJUST` to designer roles.
- [ ] Re-run focused Auth tests; expect pass.

### Task 5: Legacy Design score migration and compatibility routes

**Files:**
- Create: `src/modules/workScore/scripts/migrateDesignSubmissionScores.js`
- Modify: `src/modules/design/routes/index.js`
- Modify: `src/modules/design/controllers/designTask.controller.js`
- Remove scoring logic from `src/modules/design/services/designSubmissionScore.service.js` after delegation
- Add migration tests under `src/test/workScore/scripts`
- Update Design route/service tests

**Interfaces:**
- Migration maps existing rows to `DESIGN_SUBMISSION` and reconstructs Shop/context snapshots from Design tasks.
- Legacy Design score endpoints delegate to Work Score for one compatibility release.

- [ ] Write migration tests for dry-run, active rows, override history, void history, rerun idempotency, and missing source tasks.
- [ ] Run the migration test; expect missing script failure.
- [ ] Implement CLI flags `--dry-run` and `--limit=<1..1000>`, with counts `eligible/migrated/skipped/failed`.
- [ ] Replace legacy route internals with thin Work Score public/API delegation and preserve response compatibility where documented.
- [ ] Run Work Score migration plus existing Design score route/service tests; expect pass.

### Task 6: Design approval integration and recovery warning

**Files:**
- Modify: `src/modules/design/services/designTask.service.js`
- Modify: `src/modules/design/public.js` only if required by existing public exports
- Modify: `src/test/design/services/designTask.service.test.js`

**Interfaces:**
- Consumes `workScorePublic.recordDesignSubmissionScore(input)`.
- Produces warning `{ code: 'SCORE_CREATION_FAILED' }` without exposing internal errors.

- [ ] Add failing tests proving approval records one score, retry is idempotent, and score failure still returns an approved task with the warning.
- [ ] Run the focused Design service tests; verify the score-failure test currently rejects.
- [ ] Replace direct Design score service ownership with the Work Score public call wrapped after the authoritative approval update. Catch only the score integration failure, log it safely, and append the warning.
- [ ] Re-run Design service/routes tests; expect pass.

### Task 7: Production Scale worker snapshot and QC scoring

**Files:**
- Modify: `src/modules/production/models/productionTask.model.js`
- Modify: `src/modules/production/services/productionTask.service.js`
- Modify: `src/modules/production/dtos/productionTask.dto.js`
- Modify: `src/test/production/services/productionTask.service.test.js`
- Modify persistence/concurrency tests under `src/test/production`

**Interfaces:**
- File check gains `outputWorkerId`.
- QC Pass calls `workScorePublic.recordProductionScaleScores` with every required passing output.
- Produces warning `{ code: 'SCORE_CREATION_FAILED' }` on integration failure.

- [ ] Add failing tests that upload snapshots the assigned designer, reassignment does not transfer credit, three passing slots create three one-point scores, QC rejection creates none, replacement-before-pass scores only the final asset, and scoring failure leaves QC passed with warning.
- [ ] Run focused Production service tests; expect missing field/public-call assertions to fail.
- [ ] Persist `outputWorkerId` when output is attached. On QC Pass, map required passing checks to public command outputs after the authoritative QC update.
- [ ] Re-run Production service and concurrency tests; expect pass.

### Task 8: Idempotent cross-source backfill

**Files:**
- Create: `src/modules/workScore/scripts/backfillWorkScores.js`
- Extend: `src/modules/design/public.js`
- Extend: `src/modules/production/public.js`
- Create: `src/test/workScore/scripts/backfillWorkScores.test.js`
- Modify: `package.json`

**Interfaces:**
- Design/Production public ports expose bounded read-only candidates for recovery.
- Adds `npm run backfill:work-scores -- --dry-run --limit=100`.

- [ ] Write failing tests for dry-run, missing Design scores, three missing Scale scores, existing rows, obsolete replacement output system-void, rerun idempotency, and partial failure reporting.
- [ ] Run the focused backfill test; expect missing script failure.
- [ ] Implement bounded candidate reads and reuse the exact Work Score recording/void commands. Do not import source repositories directly.
- [ ] Add the package script and rerun focused tests; expect pass.

### Task 9: Backend release gates and one commit

- [ ] Run `npm test -- --runInBand src/test/workScore src/test/design src/test/production src/test/auth`.
- [ ] Run architecture/module-boundary tests and `npm run lint` if the backend package defines it.
- [ ] Run migration and backfill dry-run against the dedicated test database; verify zero writes by readback.
- [ ] Run migration and backfill against the test database; verify counts and cross-Shop queries.
- [ ] Run `git diff --check` and inspect staged paths.
- [ ] Stage only backend Work Score/Design/Production/Auth/docs changes and create one commit:
  `feat(work-score): add unified design and scale scoring`.
