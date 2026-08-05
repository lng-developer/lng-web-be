# MongoDB Storage And Index Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only MongoDB index audit, produce an evidence-backed first reduction batch for `orders`, `orderitems`, and `financesnapshots`, then safely apply and verify that batch locally.

**Architecture:** A small audit module reads MongoDB metadata and classifies exact duplicates and compatible left-prefix coverage without mutating the database. A separate allowlisted apply script defaults to dry-run and requires `--apply`; model declarations change in the same reviewed batch so removed indexes are not recreated. Runtime query evidence, rollback definitions, tests, explains, and API benchmarks gate every removal.

**Tech Stack:** Node.js, CommonJS, MongoDB Node driver through Mongoose, Jest, k6, PowerShell.

## Global Constraints

- First batch covers only `orders`, `orderitems`, and `financesnapshots`.
- Never classify an index as removable only because `$indexStats.accesses.ops` is zero.
- Keep `_id`, unique, TTL, sparse, partial, collation-specific, idempotency, deduplication, lease, and transaction-supporting indexes unless equivalence is proven with identical options.
- Audit mode must not create, drop, hide, rebuild, compact, or synchronize indexes.
- Apply mode defaults to dry-run and requires the exact `--apply` flag.
- Print the database name and exact index names before any mutation.
- Never mutate a non-local database without separate user approval.
- Reject the batch if an important endpoint p95 regresses by more than 10% or returns any errors.
- Do not add dependencies.
- Do not use `Model.syncIndexes()`.
- Do not commit, merge, or push unless explicitly requested.

---

## File Map

- Create `src/scripts/mongoIndexAudit.js`: pure comparison helpers plus read-only collection/database inventory.
- Create `src/scripts/auditMongoIndexes.js`: CLI that connects to configured MongoDB and writes JSON to stdout.
- Create `src/scripts/mongoIndexReduction.batch1.js`: reviewed allowlist with exact original definitions and evidence.
- Create `src/scripts/applyMongoIndexReduction.js`: local-only dry-run/apply command and rollback output.
- Create `src/test/scripts/mongoIndexAudit.test.js`: structural classification and read-only inventory tests.
- Create `src/test/scripts/applyMongoIndexReduction.test.js`: dry-run, local guard, apply, and rollback tests.
- Modify `src/modules/order/models/order.model.js`: remove only approved redundant declarations.
- Modify `src/modules/order/models/orderItem.model.js`: remove only approved redundant declarations.
- Modify `src/modules/finance/models/financeSnapshot.model.js`: remove only approved redundant declarations.
- Modify `package.json`: expose audit and apply commands.

### Task 1: Read-Only Index Inventory And Structural Classifier

**Files:**
- Create: `src/scripts/mongoIndexAudit.js`
- Test: `src/test/scripts/mongoIndexAudit.test.js`

**Interfaces:**
- Produces: `sameKeyPattern(left, right): boolean`
- Produces: `hasCompatibleOptions(covered, covering): boolean`
- Produces: `isLeftPrefix(covered, covering): boolean`
- Produces: `classifyIndexes(indexes): Array<IndexFinding>`
- Produces: `collectMongoIndexAudit(db, collectionNames): Promise<AuditReport>`
- `IndexFinding` contains `indexName`, `classification`, `coveredBy`, and `reason`.
- `AuditReport` contains database totals and per-collection storage, definitions, usage counters, and structural findings.

- [ ] **Step 1: Write classifier tests that fail before implementation**

Cover these exact cases:

```js
expect(isLeftPrefix(
  { key: { orderId: 1 } },
  { key: { orderId: 1, createdAt: 1, _id: 1 } },
)).toBe(true);

expect(isLeftPrefix(
  { key: { orderedAt: 1 } },
  { key: { orderedAt: -1, _id: -1 } },
)).toBe(true);

expect(hasCompatibleOptions(
  { unique: true },
  { unique: false },
)).toBe(false);

expect(classifyIndexes([
  { name: '_id_', key: { _id: 1 } },
  { name: 'orderId_1', key: { orderId: 1 } },
  { name: 'orderId_1_createdAt_1__id_1', key: { orderId: 1, createdAt: 1, _id: 1 } },
])).toEqual(expect.arrayContaining([
  expect.objectContaining({ indexName: 'orderId_1', classification: 'COVERED', coveredBy: 'orderId_1_createdAt_1__id_1' }),
]));
```

Verify that unique, TTL, sparse, partial, and collation differences are never returned as `DUPLICATE` or `COVERED`.

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
node -r dotenv/config node_modules/jest/bin/jest.js src/test/scripts/mongoIndexAudit.test.js --runInBand
```

Expected: FAIL because `src/scripts/mongoIndexAudit.js` does not exist.

- [ ] **Step 3: Implement the smallest compatible comparison functions**

Use `Object.entries(index.key)` in declared order. Direction `1` and `-1` are compatible for a single-field prefix because MongoDB can traverse a B-tree in reverse; hashed, text, wildcard, and geospatial entries must match exactly. Compare `unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`, and `collation` using stable JSON values.

Do not infer query usefulness in this pure classifier.

- [ ] **Step 4: Add a mocked read-only inventory test**

Provide a fake `db` exposing only `command()`, `listCollections().toArray()`, `collection().listIndexes().toArray()`, and `collection().aggregate().toArray()`. Assert calls are limited to `dbStats`, `collStats`, `listIndexes`, and `$indexStats`; assert no `dropIndex`, `createIndex`, `compact`, or `syncIndexes` method is used.

- [ ] **Step 5: Implement `collectMongoIndexAudit` and run GREEN**

Return byte counts without rounding so reports remain machine-readable. If `$indexStats` is unauthorized, record `usageAvailable: false` and continue; other metadata errors must fail the command.

Run the focused test again. Expected: PASS.

### Task 2: Audit CLI And Baseline Report

**Files:**
- Create: `src/scripts/auditMongoIndexes.js`
- Modify: `package.json`
- Test: `src/test/scripts/mongoIndexAudit.test.js`

**Interfaces:**
- Consumes: `collectMongoIndexAudit(db, ['orders', 'orderitems', 'financesnapshots'])`.
- Produces command: `npm run audit:mongo-indexes`.
- Produces JSON on stdout; errors and connection failures go to stderr with non-zero exit code.

- [ ] **Step 1: Add a failing CLI delegation test**

Export `main({ connectDatabase, disconnectDatabase, output })`. Assert it connects once, audits exactly the three batch-one collections, writes one valid JSON document, and disconnects in `finally`.

- [ ] **Step 2: Run the focused test and observe RED**

Use the Task 1 Jest command. Expected: FAIL because CLI `main` is missing.

- [ ] **Step 3: Implement the CLI and package command**

Add:

```json
"audit:mongo-indexes": "node src/scripts/auditMongoIndexes.js"
```

Use the configured Mongoose connection and `require.main === module` guard. Do not accept an apply flag in this command.

- [ ] **Step 4: Run tests and the real local audit**

Run:

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
npm run audit:mongo-indexes > mongo-index-audit.batch1.json
```

Validate JSON parsing and confirm the report names database `lng_web_be`. Keep `mongo-index-audit.batch1.json` untracked.

- [ ] **Step 5: Record the immutable before baseline**

Record collection count, document count, data bytes, storage bytes, total index bytes, index count, installed definitions, and usage counters for the three collections. Do not change models or MongoDB in this task.

### Task 3: Evidence-Backed Batch-One Allowlist

**Files:**
- Create: `src/scripts/mongoIndexReduction.batch1.js`
- Test: `src/test/scripts/mongoIndexAudit.test.js`

**Interfaces:**
- Produces `batchOne`: array of `{ collection, indexName, originalDefinition, classification, coveredBy, queryEvidence }`.
- Every entry must match an installed index definition from Task 2.
- Initial static candidates to verify, not automatically approve:
  - `orders.orderedAt_1` covered by `orderedAt_-1__id_-1`;
  - `orders.shopConnectionId_1` covered by `shopConnectionId_1_orderedAt_-1`;
  - `orderitems.orderId_1` covered by `orderId_1_createdAt_1__id_1` and `orderId_1_externalItemId_1`;
  - `orderitems.asin_1` covered by `asin_1_sku_1`;
  - `orderitems.externalAccountId_1` covered by `externalAccountId_1_createdAt_-1`;
  - `orderitems.shopId_1` covered by `shopId_1_createdAt_-1__id_-1`;
  - `financesnapshots.orderId_1` covered by `orderId_1_calculatedAt_-1`;
  - `financesnapshots.shopId_1` covered by `shopId_1_calculatedAt_-1`;
  - `financesnapshots.sellerEmployeeCode_1` covered by `sellerEmployeeCode_1_calculatedAt_-1`;
  - `financesnapshots.teamId_1` covered by `teamId_1_calculatedAt_-1`.

- [ ] **Step 1: Trace every candidate through repository, worker, and script queries**

Use CodeGraph first, then `rg` for exact fields. Record each matching query path in `queryEvidence`. Reject candidates used by a sort or query shape that the proposed covering index cannot support.

- [ ] **Step 2: Capture explain evidence for retained coverage**

For each candidate, run its real repository query with `explain('executionStats')` against the local benchmark database. Record `winningPlan`, `totalKeysExamined`, `totalDocsExamined`, and `nReturned` before removal.

- [ ] **Step 3: Write a failing allowlist validation test**

The test loads the Task 2 audit fixture and asserts every allowlisted index exists, is non-unique, has no TTL/sparse/partial/collation options, has a named covering index, and passes `isLeftPrefix` plus compatible-option checks.

- [ ] **Step 4: Populate only candidates supported by static and explain evidence**

Do not add an entry to meet the 30% target. Classify rejected candidates as `KEEP` in the audit notes rather than putting them in `batchOne`.

- [ ] **Step 5: Run the focused audit tests**

Expected: PASS with the final reviewed allowlist and no database mutation.

### Task 4: Guarded Dry-Run And Apply Tool

**Files:**
- Create: `src/scripts/applyMongoIndexReduction.js`
- Create: `src/test/scripts/applyMongoIndexReduction.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `batchOne` from `mongoIndexReduction.batch1.js`.
- Produces: `main({ argv, config, connectDatabase, disconnectDatabase, output, confirm })`.
- Produces command: `npm run indexes:reduce -- [--apply]`.
- Dry-run output contains database, collection, index name, classification, covering index, and rollback `createIndex` definition.

- [ ] **Step 1: Write failing safety tests**

Assert:

```js
await main({ argv: [], config: localConfig, ...deps });
expect(collection.dropIndex).not.toHaveBeenCalled();

await expect(main({ argv: ['--apply'], config: productionConfig, ...deps }))
  .rejects.toThrow('non-local database');

await main({ argv: ['--apply'], config: localConfig, ...deps });
expect(collection.dropIndex).toHaveBeenCalledWith('orderedAt_1');
```

Also assert apply aborts before the first drop if any installed definition differs from the allowlist.

- [ ] **Step 2: Run the test and observe RED**

Run:

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
node -r dotenv/config node_modules/jest/bin/jest.js src/test/scripts/applyMongoIndexReduction.test.js --runInBand
```

- [ ] **Step 3: Implement dry-run and local guards**

Treat `localhost`, `127.0.0.1`, and `::1` as local hosts. Require both a local host and database name `lng_web_be`. Reject unknown CLI arguments. Print and validate the entire batch before any drop.

- [ ] **Step 4: Implement exact-name apply and rollback output**

Call `dropIndex(indexName)` sequentially only after validation succeeds. Always print the original `createIndex` key and options needed for rollback. Do not call `syncIndexes`.

- [ ] **Step 5: Add package command and run GREEN**

Add:

```json
"indexes:reduce": "node src/scripts/applyMongoIndexReduction.js"
```

Run both audit/apply test files. Expected: PASS.

### Task 5: Align Model Declarations With The Reviewed Allowlist

**Files:**
- Modify: `src/modules/order/models/order.model.js`
- Modify: `src/modules/order/models/orderItem.model.js`
- Modify: `src/modules/finance/models/financeSnapshot.model.js`
- Test: `src/test/scripts/mongoIndexAudit.test.js`

**Interfaces:**
- Consumes the final Task 3 allowlist.
- Produces Mongoose schema indexes that no longer declare approved removals.

- [ ] **Step 1: Add a failing schema-declaration test**

Load `Model.schema.indexes()` for all three models and assert none of the allowlisted key/option definitions remain while every unique index remains present.

- [ ] **Step 2: Run the focused test and observe RED**

Expected: FAIL because the redundant declarations still exist.

- [ ] **Step 3: Remove only the approved declarations**

For field-level `{ index: true }`, remove only the `index` property. Preserve field validation, refs, defaults, and uniqueness. Do not refactor schemas.

- [ ] **Step 4: Run syntax and focused tests**

Run `node -c` for all three model files and both script test suites. Expected: PASS.

- [ ] **Step 5: Run architecture tests**

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
node -r dotenv/config node_modules/jest/bin/jest.js src/test/architecture.contract.test.js --runInBand
```

Expected: PASS.

### Task 6: Local Apply, Explain Comparison, And Performance Gate

**Files:**
- No production code changes unless verification exposes a defect.
- Generated local evidence remains untracked.

**Interfaces:**
- Consumes baseline from Task 2 and rollback definitions from Task 4.
- Produces final index-count, index-size, explain, benchmark, and test evidence.

- [ ] **Step 1: Show the dry-run and obtain explicit apply approval**

Run `npm run indexes:reduce` without `--apply`. Report database `lng_web_be`, exact index names, expected remaining covering indexes, and rollback commands. Do not continue to Step 2 without user approval.

- [ ] **Step 2: Apply the reviewed batch locally**

After approval only:

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
npm run indexes:reduce -- --apply
```

- [ ] **Step 3: Repeat audit and explain evidence**

Confirm only allowlisted indexes disappeared. Compare execution stats for the same query shapes and reject/rollback any removal that creates a collection scan or materially increases examined documents.

- [ ] **Step 4: Run the existing API benchmark**

Run the established local authenticated k6 matrix for Order workbench/readiness, Mapping reads, and Finance reads affected by the batch. Require `0%` errors and no important endpoint p95 regression greater than 10%.

- [ ] **Step 5: Run complete verification**

Run focused order/finance/script tests, architecture tests, then:

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
$env:LOG_LEVEL='silent'
node -r dotenv/config node_modules/jest/bin/jest.js --runInBand
git diff --check
```

- [ ] **Step 6: Report measured outcome**

Report before/after index count and bytes for each collection, total percentage reduction, explain deltas, benchmark deltas, and any candidate retained. If the batch does not reach 30%, stop rather than deleting lower-confidence indexes.

