# MongoDB Unused Field Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a read-only BSON field-size audit for five selected MongoDB collections, then classify material fields from live storage metrics and current code references without changing schemas or stored data.

**Architecture:** One small module builds aggregation pipelines and normalizes results; a separate CLI connects through the configured Mongoose connection and prints JSON. Static code tracing and installed-index evidence are combined with the JSON results in a human-readable audit report. This plan stops before any `$unset` migration; removal work is planned only if the report proves one or more `CANDIDATE_UNUSED` fields.

**Tech Stack:** Node.js, CommonJS, MongoDB aggregation, Mongoose connection, Jest, PowerShell, CodeGraph, ripgrep.

## Global Constraints

- Audit only `vendorcostcenters`, `hrattendancedailies`, `externalorderrawrecords`, `productiontasks`, and `vendorsubmissions`.
- Audit is read-only and must not create, update, unset, drop, compact, validate, or synchronize database objects.
- Do not classify a field from naming intuition or zero observed use alone.
- Preserve snapshot fields in this phase.
- Treat dynamic access and incomplete evidence as `DEFER_DYNAMIC`.
- Add no dependency.
- Do not mutate Atlas database `lng_web_be` in this plan.
- Preserve unrelated worktree changes.
- Do not commit, merge, or push unless explicitly requested.

---

## File Map

- Create `src/scripts/mongoFieldAudit.js`: aggregation pipeline construction, result normalization, and read-only collection audit.
- Create `src/scripts/auditMongoFields.js`: CLI wiring for the five collection names.
- Create `src/test/scripts/mongoFieldAudit.test.js`: pipeline, normalization, unauthorized-index-usage, and CLI tests.
- Modify `package.json`: add `audit:mongo-fields`.
- Create `docs/superpowers/reports/2026-08-02-mongodb-unused-field-audit.md`: measured results, code evidence, classifications, and recommendation.

### Task 1: BSON Field Metrics Pipeline

**Files:**
- Create: `src/scripts/mongoFieldAudit.js`
- Test: `src/test/scripts/mongoFieldAudit.test.js`

**Interfaces:**
- Produces `buildTopLevelFieldPipeline(): Array<object>`.
- Produces `normalizeFieldMetrics(rows, collectionDataBytes): Array<FieldMetric>`.
- `FieldMetric` contains `field`, `presenceCount`, `estimatedBytes`, `percentOfCollectionData`, and `types`.

- [ ] **Step 1: Write the failing pipeline test**

Assert the pipeline contains these operations in order:

```js
expect(buildTopLevelFieldPipeline()).toEqual([
  { $project: { fields: { $objectToArray: '$$ROOT' } } },
  { $unwind: '$fields' },
  expect.objectContaining({ $group: expect.objectContaining({ _id: '$fields.k' }) }),
  { $sort: { estimatedBytes: -1, _id: 1 } },
]);
```

The `$group` must sum one presence per document, estimate each field with `$bsonSize` around a one-key object containing `fields.v`, and collect representative BSON types with `$type`.

- [ ] **Step 2: Run the test and observe RED**

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
node -r dotenv/config node_modules/jest/bin/jest.js src/test/scripts/mongoFieldAudit.test.js --runInBand
```

Expected: FAIL because `mongoFieldAudit.js` does not exist.

- [ ] **Step 3: Implement the minimal pipeline builder**

Use only native aggregation expressions. Exclude `_id` from removal classification later, but keep it in raw metrics so totals are transparent. Do not use `$function` or server-side JavaScript.

- [ ] **Step 4: Add failing normalization tests**

Given `{ _id: 'payload', presenceCount: 10, estimatedBytes: 500, types: ['object'] }` and `collectionDataBytes = 2000`, assert:

```js
expect(normalizeFieldMetrics(rows, 2000)[0]).toEqual({
  field: 'payload',
  presenceCount: 10,
  estimatedBytes: 500,
  percentOfCollectionData: 25,
  types: ['object'],
});
```

Assert zero collection bytes produces `percentOfCollectionData: 0` rather than `NaN`.

- [ ] **Step 5: Implement normalization and run GREEN**

Round percentages to two decimal places. Preserve byte counts as integers. Run the focused Jest command; expected PASS.

### Task 2: Read-Only Collection Audit And CLI

**Files:**
- Modify: `src/scripts/mongoFieldAudit.js`
- Create: `src/scripts/auditMongoFields.js`
- Modify: `src/test/scripts/mongoFieldAudit.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces `auditCollectionFields(db, collectionName): Promise<CollectionFieldAudit>`.
- Produces `auditMongoFields(db, collectionNames): Promise<MongoFieldAuditReport>`.
- Produces CLI `main({ connectDatabase, disconnectDatabase, audit, output }): Promise<MongoFieldAuditReport>`.
- Produces command `npm run audit:mongo-fields`.

- [ ] **Step 1: Add a failing read-only audit test**

Provide a fake database exposing `command({ collStats })`, `collection().aggregate().toArray()`, and `collection().listIndexes().toArray()`. Assert the result includes:

```js
{
  name: 'productiontasks',
  documentCount: 72,
  dataBytes: 285048,
  averageDocumentBytes: 3959,
  fields: expect.any(Array),
  indexes: expect.any(Array),
}
```

Assert the fake collection has no mutation method calls and that the aggregation pipeline equals `buildTopLevelFieldPipeline()`.

- [ ] **Step 2: Run the test and observe RED**

Expected: FAIL because `auditCollectionFields` and `auditMongoFields` are missing.

- [ ] **Step 3: Implement collection and multi-collection audit**

Use `collStats`, one field aggregation, and `listIndexes` per collection. Include exact installed index key patterns so classification can detect indexed fields. Fail on metadata errors; this command does not need `$indexStats` because field removal decisions are based on code and contract evidence, not index operation counters.

- [ ] **Step 4: Add a failing CLI delegation test**

Assert `main` audits exactly:

```js
[
  'vendorcostcenters',
  'hrattendancedailies',
  'externalorderrawrecords',
  'productiontasks',
  'vendorsubmissions',
]
```

Assert it writes one valid JSON document and disconnects in `finally`.

- [ ] **Step 5: Implement CLI and package command**

Add:

```json
"audit:mongo-fields": "node -r dotenv/config src/scripts/auditMongoFields.js"
```

Use `require.main === module`; write errors to stderr and set a non-zero exit code.

- [ ] **Step 6: Run focused tests and syntax checks**

Run the Task 1 Jest command plus `node -c` for both scripts. Expected: PASS.

### Task 3: Execute Atlas Read-Only Audit

**Files:**
- No tracked output file from the raw command.

**Interfaces:**
- Consumes `npm run audit:mongo-fields`.
- Produces live metrics for database `lng_web_be` without mutation.

- [ ] **Step 1: Run the command against configured Atlas**

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
npm run audit:mongo-fields
```

Confirm the report names database `lng_web_be` and contains exactly five collections.

- [ ] **Step 2: Validate field-byte estimates**

For each collection, compare summed estimated field bytes with `collStats.size`. Document that one-key BSON wrappers add fixed overhead, so field metrics are comparative estimates rather than an exact partition of collection size.

- [ ] **Step 3: Select material fields for static tracing**

Trace every field that is at least 1% of collection logical bytes or at least 64 KiB estimated. Always include snapshot, raw payload, metadata, history, and empty-array/object fields even when below the threshold. Do not classify fields below both thresholds unless they are obvious contract or operational fields needed to explain the document shape.

### Task 4: Code And Contract Evidence Classification

**Files:**
- Create: `docs/superpowers/reports/2026-08-02-mongodb-unused-field-audit.md`

**Interfaces:**
- Consumes live metrics from Task 3.
- Produces one classification per traced field using only `KEEP_CONTRACT`, `KEEP_OPERATIONAL`, `KEEP_SNAPSHOT`, `KEEP_SMALL`, `CANDIDATE_UNUSED`, or `DEFER_DYNAMIC`.

- [ ] **Step 1: Map each collection to its owning model and repository**

Use CodeGraph first. Then use `rg` to cover dynamic strings and scripts. Start from:

- `src/modules/vendor/models/vendorCostCenter.model.js` and vendor repositories/services;
- the HR attendance daily model/repository/service under `src/modules/hr`;
- `src/modules/integration/externalOrderImport` raw-record model/repository/service;
- `src/modules/production/models/productionTask.model.js` and its repository/service/DTO/public port;
- `src/modules/vendorSubmission` model/repository/service/DTO/public port.

- [ ] **Step 2: Trace every material field end to end**

For each field, search exact property access, quoted aggregation paths, projections, object spreads, import/export headers, worker and cron use, migration and seed scripts, DTO serialization, tests, and installed index keys. Record concrete file paths and behavior in the report.

- [ ] **Step 3: Classify snapshots and dynamic fields conservatively**

Classify order, item, listing, vendor, cost-center, customization, address, user, and payload snapshots as `KEEP_SNAPSHOT` when they preserve historical state. Classify raw import payloads and recovery metadata as `KEEP_OPERATIONAL`. Use `DEFER_DYNAMIC` when generic mapping or object spreading prevents proof of non-use.

- [ ] **Step 4: Classify only proven unused material fields as candidates**

A `CANDIDATE_UNUSED` row must contain measured estimated bytes, presence count, absence of index references, absence of live code/contract references, and a statement explaining why migration risk is acceptable. If any evidence item is missing, use `DEFER_DYNAMIC`.

- [ ] **Step 5: Add report summary and recommendation**

Report total logical bytes covered, estimated removable bytes, percentage savings, candidate list, deferred list, and whether a removal batch is justified before deployment. Explicitly state when no migration should be built.

### Task 5: Verification And Handoff

**Files:**
- Test: `src/test/scripts/mongoFieldAudit.test.js`
- Verify: `docs/superpowers/reports/2026-08-02-mongodb-unused-field-audit.md`

**Interfaces:**
- Produces verified audit tooling and an evidence report; no schema or database mutation.

- [ ] **Step 1: Run focused and architecture tests**

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
node -r dotenv/config node_modules/jest/bin/jest.js src/test/scripts/mongoFieldAudit.test.js src/test/architecture.contract.test.js --runInBand
```

- [ ] **Step 2: Run full suite and diff check**

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
$env:LOG_LEVEL='silent'
node -r dotenv/config node_modules/jest/bin/jest.js --runInBand
git diff --check
```

- [ ] **Step 3: Present the evidence gate**

If there are no `CANDIDATE_UNUSED` fields with material savings, recommend stopping. If candidates exist, present exact collection/field/estimated-byte rows and ask whether to write a separate backup-and-`$unset` implementation spec. Do not mutate Atlas in either case.

