# MongoDB Index Reconciliation Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile two missing unique indexes and remove the ten approved covered indexes from source and Atlas `lng_web_be`.

**Architecture:** Add one allowlisted batch definition and one guarded CLI following the existing index-reduction script. Align Mongoose declarations first, verify all installed definitions in dry-run mode, then apply the two correctness changes before the reduction set.

**Tech Stack:** Node.js, CommonJS, Mongoose/MongoDB driver, Jest.

## Global Constraints

- Target only database `lng_web_be`.
- Do not use `syncIndexes()`.
- Refuse unknown definitions before any write.
- Check duplicates before creating unique indexes.
- Restore the legacy `listings` index if its partial-unique replacement fails.
- Preserve every index outside the approved allowlist.
- Do not commit unrelated dirty-worktree changes.

---

### Task 1: Guarded batch-2 CLI

**Files:**
- Create: `src/scripts/mongoIndexReconciliation.batch2.js`
- Create: `src/scripts/applyMongoIndexReconciliationBatch2.js`
- Test: `src/test/scripts/applyMongoIndexReconciliationBatch2.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: configured Mongo URI and the existing `connectDatabase()` / `disconnectDatabase()` functions.
- Produces: `main({ argv, databaseUri, connectDatabase, disconnectDatabase, output })` and an exact immutable batch allowlist.

- [ ] **Step 1: Write failing tests**

Cover dry-run no-write behavior, rejection of unexpected database/definitions, duplicate preflight refusal, listings rollback, exact ten-index reduction, and final definition verification.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx jest src/test/scripts/applyMongoIndexReconciliationBatch2.test.js --runInBand`

Expected: FAIL because the batch-2 modules do not exist.

- [ ] **Step 3: Implement the minimal allowlist and CLI**

Reuse the existing key/option comparison helpers. Accept only `--apply` and `--allow-remote`; require both for Atlas writes. Print every planned change and rollback definition before applying.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx jest src/test/scripts/applyMongoIndexReconciliationBatch2.test.js --runInBand`

Expected: PASS.

### Task 2: Align Mongoose index declarations

**Files:**
- Modify: `src/modules/hr/models/attendanceDaily.model.js`
- Modify: `src/modules/vendor/models/vendorCostCenter.model.js`
- Modify: `src/modules/order/models/order.model.js`
- Modify: `src/modules/order/models/orderItem.model.js`
- Modify: `src/modules/order/models/orderTimeline.model.js`
- Modify: `src/modules/catalog/models/listing.model.js`
- Test: `src/test/scripts/applyMongoIndexReconciliationBatch2.test.js`

**Interfaces:**
- Consumes: the approved reduction allowlist.
- Produces: Mongoose `schema.indexes()` output without the nine source-generated single-field indexes; the stale Audit index is already absent from source.

- [ ] **Step 1: Add a failing schema-contract test**

Assert that each approved single-field key is absent and each covering compound key remains declared.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest src/test/scripts/applyMongoIndexReconciliationBatch2.test.js --runInBand`

Expected: FAIL on the existing `index: true` declarations.

- [ ] **Step 3: Remove only the nine redundant `index: true` flags**

Do not alter field types, validation, unique indexes, TTL indexes, repositories, or DTOs.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npx jest src/test/scripts/applyMongoIndexReconciliationBatch2.test.js --runInBand`

Expected: PASS.

### Task 3: Dry-run, apply, and verify Atlas

**Files:**
- No source edits.

**Interfaces:**
- Consumes: the tested batch-2 CLI and the configured Atlas URI.
- Produces: verified Atlas definitions matching the current schema and approved reduction set.

- [ ] **Step 1: Run syntax and focused verification**

Run `node -c` for each changed JavaScript file, then:

`npx jest src/test/scripts/applyMongoIndexReconciliationBatch2.test.js src/test/scripts/mongoIndexAudit.test.js --runInBand`

- [ ] **Step 2: Run guarded Atlas dry-run**

Run: `npm run indexes:reconcile:batch2 -- --allow-remote`

Expected: refusal because `--allow-remote` is valid only with `--apply`; then run the documented dry-run without remote authorization and confirm the database and exact allowlist without writes.

- [ ] **Step 3: Apply the approved Atlas changes**

Run: `npm run indexes:reconcile:batch2 -- --apply --allow-remote`

Expected: two correctness indexes verified and exactly ten covered indexes removed.

- [ ] **Step 4: Run post-apply audit**

Verify zero duplicate groups, both required unique definitions, absence of the ten dropped indexes, presence of all covering indexes, and the new total index count/storage.

- [ ] **Step 5: Run architecture verification**

Run: `npm run test:architecture -- --runInBand`

Expected: PASS.
