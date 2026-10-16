# Design Type routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate PNG and Scale using real task Design Type, with independent task difficulty and consistent scores.

**Architecture:** Retain one ProductionTask lifecycle. Persist effective design type and automatic/manual provenance, derive queue from type, and use repository filters before pagination. Preserve module public ports and the existing conditional mutation/audit mechanism.

**Tech Stack:** Node/CommonJS, Mongoose, Joi, Jest; React, Ant Design, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-png-scale-task-routing-design.md`, including its approved amendment.

## Global Constraints

- NORMAL -> Scale; CUSTOM_IMAGE -> PNG; unknown -> review, never implicit Normal.
- Difficulty remains NORMAL/HARD/SPECIAL, independent of Design Type.
- No new dependencies, separate PNG documents or persisted queue field.
- Preserve existing dirty files, public ports, permission scopes and cancellation/QC guards.
- No deployment, shared DB backfill, historical score recalculation or commits without authorization.
- BE checkout: `C:/Users/admin/.codex/worktrees/manual-vendor-product/lng-web-be`; FE: `C:/lng_system/lng-web/lng-web-fe`.

## Review Focus

- Failed buyer image downloads still route to PNG; main images/previews never prove a buyer upload (Task 1).
- Legacy/unparsed records remain visible through review, not lost or falsely classified (Tasks 1 and 4).
- Recheck versus manual editing must preserve the leader's choice (Task 2).
- Concurrent QC, cancellation and classification edits must not overwrite each other (Tasks 2 and 3).
- Empty pages, summary/export and unassigned pagination must use identical filters (Tasks 1 and 4).

### Task 1: Real classification and repository filters

**Files:** production `models/productionTask.model.js`, `services/productionTask.service.js`, `repositories/productionTask.repository.js`, `dtos/productionTask.dto.js`, `validators/productionTask.validator.js`; matching existing files under `tests/production/{models,services,repositories,dtos,validators}/`.

**Interfaces:** DTO exposes `designType: NORMAL|CUSTOM_IMAGE|null`, `designTypeSource: AUTO|MANUAL`, `designTypeReason`. Query accepts `designType` and existing server-side `unassigned`. Creation/recheck derives automatic type from normalized customization evidence. Existing missing-type tasks require explicit review/backfill, not a read-time write.

- [ ] Add tests asserting genuine/failed buyer uploads -> CUSTOM_IMAGE; parsed text-only -> NORMAL; preview-only/unparsed -> null. Assert type filters run before pagination, summaries share the predicate, and unassigned filtering is server-side.
- [ ] Run `npm test -- --runInBand tests/production`; confirm new assertions fail for missing behavior.
- [ ] Implement classification in the Production service using existing Customization public data; persist type/provenance and expose validated filters/DTO. Preserve manual classification on recheck.
- [ ] Run the same command; verify classification/filter tests pass and inspect regressions.

### Task 2: Leader classification and difficulty edit

**Files:** production model/service/repository/DTO/validator above, `routes/index.js`, `controllers/productionTask.controller.js`; `tests/production/routes/index.test.js`, validator/service tests and `tests/production/productionConcurrency.persistence.test.js`.

**Interfaces:** `PATCH /tasks/:taskId/classification` accepts `{ designType: NORMAL|CUSTOM_IMAGE|null, difficultyLevel: NORMAL|HARD|SPECIAL|null, reason, expectedUpdatedAt }`. Null restores the automatic/default value. Expose effective difficulty and its source. Reuse Scale assignment authority and scope checks.

- [ ] Add tests for leader success, designer denial, out-of-scope denial, invalid enum/empty reason, stale update, cancellation and QC lock; assert assignee/files/status and listing difficulty remain unchanged.
- [ ] Run `npm test -- --runInBand tests/production`; confirm new tests fail for the missing endpoint/behavior.
- [ ] Implement route/controller validation, service authorization and audited conditional repository mutation. Coordinate recheck with the same concurrency protection.
- [ ] Re-run production tests; require pass for the new permission and race cases.

### Task 3: Freeze difficulty for scoring and recovery

**Files:** production model/service/DTO and service/concurrency tests; `src/modules/workScore/services/workScore.service.js` only if its existing public contract needs adjustment; `tests/workScore/services/workScore.service.test.js`.

**Interfaces:** QC finalization stores the effective difficulty snapshot atomically. Immediate scoring and `listWorkScoreCandidates` supply the same `contextSnapshot.scaleDifficultyLevel` for each eligible output.

- [ ] Add tests asserting task override beats listing default, QC edit races conflict, later listing edits cannot alter finalized points, retry creates no duplicate score, and legacy missing evidence is reported rather than guessed.
- [ ] Run `npm test -- --runInBand tests/production tests/workScore`; observe the expected new failures.
- [ ] Implement frozen difficulty in the existing conditional QC mutation; use it in immediate/recovery scoring without changing configured point amounts.
- [ ] Re-run those suites; verify points, worker identity and idempotency assertions pass.

### Task 4: FE queues, editor and truthful Design Type display

**Files:** FE `src/features/portal/production/api/productionApi.ts`, `productionKeys.ts`, `pages/ProductionWorkbenchPage.tsx`, `ProductionWorkbenchExpandedRow.tsx`; new `pages/TaskClassificationEditor.tsx`; `src/features/portal/design/api/designApi.ts`, `pages/PngTasksPage.tsx`, `PsdTasksPage.tsx`; both common locale files. BE `src/modules/design/dtos/designTask.dto.js` and its tests for removal of fabricated NORMAL.

**Interfaces:** PNG sends CUSTOM_IMAGE; Scale sends NORMAL; shared QC remains unfiltered by type. Editor consumes Task 2 endpoint and invalidates production lists/summaries. Unknown PSD Design Type renders a dash. Existing legacy type fields may be accepted for compatibility but not used as authoritative routing evidence.

- [ ] Add FE tests in existing `src/test/portal/design/pages/PngTasksPage.test.tsx`, `PsdTasksPage.test.tsx`, `src/test/portal/production/pages/ProductionWorkbenchPage.test.tsx` and new `TaskClassificationEditor.test.tsx`: distinct API parameters, server-side unassigned, matching counts/export filters, authorized controls, pending/error handling and invalidation. Assert unknown type never renders Normal.
- [ ] Run `npx vitest run src/test/portal/design/pages src/test/portal/production`; observe new failures.
- [ ] Implement API types/client, shared editor, labels and filters. Remove client-page filtering and unsupported classification options from the affected task controls. Keep all existing assignment/upload/QC actions.
- [ ] Re-run targeted Vitest tests, `npx tsc --noEmit`, and changed-file lint; verify no new failures.

### Task 5: Integrated verification and safe handoff

- [ ] Run BE `npm run test:architecture -- --runInBand`, then `npm test -- --runInBand`; report any failures by suite, including unrelated baseline failures.
- [ ] Run FE `npx vitest run`; report failures and compare with the existing baseline rather than claiming full green.
- [ ] Inspect both diffs and test a local, isolated fixture containing one NORMAL, one CUSTOM_IMAGE and one unclassified task. Verify both queues, editing, QC and scoring without operational DB writes.
- [ ] Provide a read-only legacy classification count before requesting any separately authorized shared DB backfill. Do not restart operational processes or deploy as a side effect of tests.
- [ ] Hand off results and remaining risks. Commit only if requested.

## Self-review

The approved Design Type amendment replaces both stored queue and manual queue override. Existing assignment, lifecycle, asset blockers, scopes and scoring identities are retained. All five review-focus conditions have owning test tasks. Broad taxonomy (Outline/Style/First Sale), AI difficulty estimation, data migration and deployment are excluded.

## Execution handoff

### 2026-10-16 routing repair delivered locally

### Assigned Designer upload repair

The user approved fixing the missing upload control after switching hieunv to DESIGNER. Reproduced with failing service (403), HTTP route (403), and FE visibility tests. Scale upload/manual-slot/QC-submit gates now accept DESIGN:WORK, with the service requiring exact assignedDesignUserId. Conditional slot creation, attachment and QC submission retain that assignment predicate so reassignment cannot silently authorize a stale upload. Existing CS scale permissions and QC/cancellation guards remain unchanged. No role expansion or operational file upload was performed. FE renders Add output file for the assigned Designer and explains an empty output list instead of claiming zero outputs are required. Verified 282 production/architecture tests, 23 FE tests, TypeScript and lint; the full-suite run is recorded separately in local test logs.

Full BE verification: 418 suites / 3507 tests passed, 23 tests skipped; Jest warned about a worker teardown leak. Full FE run stopped after prolonged execution, with failures in ImportJobPanel (2), OrderItemPanel (1), CatalogListingWorkbenchPage (5); no all-green FE claim. Local FE 5173 serves the new Designer gate and BE 5000 health returns OK. No real file upload or browser-session E2E was performed.

Implemented the bounded routing slice: persisted automatic NORMAL/CUSTOM_IMAGE classification from normalized buyer inputs, manual-source preservation, validated query/DTO fields, repository list/count/summary/export filtering, server-side PNG assignment filtering and an Unclassified selector on Scale. QC remains shared. ZIP previews alone do not establish a buyer upload.

User-authorized correction in `lng_web_be`: tasks `6ad1c3be8c747b81f58f8e82` and `6ad1c3af8c747b81f58f8e7f` changed from missing type to NORMAL/AUTO in one conditional transaction with audit events. Readback asserted assignment, lifecycle, fileChecks and customizationSnapshot unchanged. Live service list and summary agree: NORMAL=2, CUSTOM_IMAGE=0, UNCLASSIFIED=0 (Amazon, PSD-ready).

Verified 274 BE production/architecture tests, 19 FE page tests, TypeScript and changed-file lint. Local API-only BE restarted at 5000 with workers off; FE 5173 responds. No deployment or commit. The broader manual classification/difficulty editor, frozen scoring and unrelated PSD taxonomy remain pending; this does not mark all plan tasks complete.

Pending user review. Recommend inline execution because the tasks share the same Production service and API contract; separate simultaneous implementations would overlap. An independent final review can follow execution if authorized.
