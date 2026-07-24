# Design Approved Asset Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Award one active score to each asset approved in Design Review, without duplicate awards.

**Architecture:** The `design` module remains the sole score owner. The existing task approval transition creates the score; Production/Scale QC remains excluded because it does not identify the designer asset to reward.

**Tech Stack:** Node.js, Express, MongoDB/Mongoose, Jest.

## Global Constraints

- Scope is `PSD_TEMPLATE` Design Task approval only; Production QC does not award designer points.
- Score identity becomes `taskId + submissionId + assetId`.
- Keep the current task-type and priority point formula; quality multipliers are out of scope.
- Preserve score override and void RBAC.
- An index migration runs only after a dry-run reports zero unresolved legacy scores and explicit approval.

---

### Task 1: Persist the approved asset as part of each score

**Files:**
- Modify: `src/modules/design/models/designSubmissionScore.model.js`
- Modify: `src/modules/design/repositories/designSubmissionScore.repository.js`
- Modify: `src/modules/design/services/designSubmissionScore.service.js`
- Test: `src/test/design/models/designSubmissionScore.model.test.js`
- Test: `src/test/design/repositories/designSubmissionScore.repository.test.js`
- Test: `src/test/design/services/designSubmissionScore.service.test.js`

**Produces:** `assetId` on `DesignSubmissionScore`; `upsertAutoScore` uses all three IDs.

- [ ] Write a failing test that approves a submission and expects its selected `approvedAssetId` in the score payload.

```js
await service.scoreApprovedSubmission(task, { ...submission, approvedAssetId }, authContext)
expect(repository.upsertAutoScore).toHaveBeenCalledWith(expect.objectContaining({
  taskId, submissionId, assetId: approvedAssetId,
}))
```

- [ ] Run `npm test -- src/test/design/services/designSubmissionScore.service.test.js --runInBand` and confirm it fails because `assetId` is absent.
- [ ] Add the required schema field and score guard:

```js
assetId: { type: Schema.Types.ObjectId, ref: 'MediaAsset', required: true, index: true },
const assetId = toId(submission.approvedAssetId)
if (!assetId || submission.status !== designTaskSubmissionStatuses.APPROVED) return null
```

- [ ] Change `upsertAutoScore` lookup to `{ taskId, submissionId, assetId }`; retain `$setOnInsert` so repeated approval is idempotent.
- [ ] Run the three focused model/repository/service tests and commit:

```bash
git commit -m "feat(design): score each approved design asset"
```

### Task 2: Expose the exact scored asset in API read models

**Files:**
- Modify: `src/modules/design/dtos/designSubmissionScore.dto.js`
- Modify: `src/modules/design/dtos/designWorkspace.dto.js`
- Modify: `src/modules/design/repositories/designSubmissionScore.repository.js`
- Test: `src/test/design/services/designTask.service.test.js`
- Test: `src/test/design/services/designSubmissionScore.service.test.js`

**Produces:** `toScoreDto(score).assetId`; scoring list uses `row.assetId` for its file.

- [ ] Write failing assertions for a returned `assetId` and a file DTO resolved from that ID.

```js
expect(scoreDto.assetId).toBe(String(approvedAssetId))
expect(rowDto.file.id).toBe(String(approvedAssetId))
```

- [ ] Run `npm test -- src/test/design/services/designTask.service.test.js src/test/design/services/designSubmissionScore.service.test.js --runInBand` and confirm the assertions fail.
- [ ] Implement the smallest DTO changes:

```js
assetId: toId(score.assetId),
file: toAssetDto(assetsById[String(row.assetId)]),
```

- [ ] Run the focused tests and commit:

```bash
git commit -m "feat(design): expose approved asset score evidence"
```

### Task 3: Make voiding an asset score unambiguous

**Files:**
- Modify: `src/modules/design/validators/designTask.validator.js`
- Modify: `src/modules/design/controllers/designTask.controller.js`
- Modify: `src/modules/design/routes/index.js`
- Modify: `src/modules/design/repositories/designSubmissionScore.repository.js`
- Modify: `src/modules/design/services/designSubmissionScore.service.js`
- Test: `src/test/design/routes/index.test.js`
- Test: `src/test/design/services/designSubmissionScore.service.test.js`

**Produces:** `POST /tasks/:taskId/submissions/:submissionId/assets/:assetId/score/void` that voids one asset score only.

- [ ] Write a failing test proving voiding `assetA` does not target `assetB` in the same submission.

```js
await service.voidSubmissionScore(taskId, submissionId, assetA, { voidReason: 'Duplicate file' }, authContext)
expect(repository.voidByTaskSubmissionAsset).toHaveBeenCalledWith(taskId, submissionId, assetA, expect.any(Object))
```

- [ ] Run `npm test -- src/test/design/services/designSubmissionScore.service.test.js src/test/design/routes/index.test.js --runInBand` and confirm it fails because the old operation has no `assetId`.
- [ ] Add `assetId: objectId.required()` to the route params schema and use this repository filter:

```js
{ taskId, submissionId, assetId, status: designScoreStatuses.ACTIVE }
```

- [ ] Run focused tests and commit:

```bash
git commit -m "feat(design): void a score by approved asset"
```

### Task 4: Safely migrate existing scores and the unique index

**Files:**
- Create: `src/modules/design/scripts/migrateSubmissionScoreAssetIds.js`
- Test: `src/test/design/scripts/migrateSubmissionScoreAssetIds.test.js`
- Create: `docs/architecture/design-scoring.md`

**Produces:** an idempotent `--dry-run` / `--apply` migration; a documented deployment runbook.

- [ ] Write failing tests for resolved and unresolved legacy records.

```js
expect(buildAssetIdBackfill(score, task)).toEqual({ assetId: approvedAssetId })
expect(buildAssetIdBackfill(score, taskWithoutSubmission)).toEqual({ unresolved: score.id })
```

- [ ] Run `npm test -- src/test/design/scripts/migrateSubmissionScoreAssetIds.test.js --runInBand` and confirm it fails because the helper does not exist.
- [ ] Implement dry-run reporting, reject `--apply` when unresolved records exist, backfill from the matching task submission's `approvedAssetId`, then replace index `taskId_1_submissionId_1` with `taskId_1_submissionId_1_assetId_1`.
- [ ] Document the Design Review-only trigger, score identity, correction/void behavior, and the mandatory dry-run before apply.
- [ ] Run the migration test and `npm run test:architecture -- --runInBand`; then commit:

```bash
git commit -m "feat(design): migrate scores to approved assets"
```

### Task 5: Regression and controlled rollout

**Files:**
- Verify: `src/test/design/**`

- [ ] Run `npm test -- src/test/design --runInBand`, `node -c src/modules/design/services/designSubmissionScore.service.js`, and `git diff --check`; all must exit 0.
- [ ] On the target database, run only `node src/modules/design/scripts/migrateSubmissionScoreAssetIds.js --dry-run` and review the unresolved count.
- [ ] Run `--apply` only after the count is zero and the user confirms the target database. Verify one approved PSD submission produces exactly one score with its `assetId`.
