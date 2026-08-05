# Mapping Read-Model Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mapping unmatched, summary, and config-workbench reads use bounded MongoDB queries instead of live previews and duplicated find/count operations.

**Architecture:** Persist every fulfillment resolution as either `READY` or `BLOCKED`, then serve unmatched and summary directly from `FulfillmentPlan`. Keep existing public API response contracts while replacing repository fanout with `$facet` aggregations and one grouped normalization query.

**Tech Stack:** Node.js, Express, CommonJS, Mongoose/MongoDB aggregation, Jest, k6

## Global Constraints

- Cross-module calls use the target module's `public.js`; controllers and services do not import foreign models.
- Read APIs never call `buildPreview()`.
- No new dependency or cache.
- Backfill targets only the configured local database, is idempotent, and never deletes data.
- Preserve DTO and pagination response shapes.

---

### Task 1: Persist blocked fulfillment plans

**Files:**
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Test: `src/test/mapping/services/fulfillmentPlan.service.test.js`

**Interfaces:**
- Consumes: existing `repository.upsertByOrderItem(orderItemId, payload)` and `buildPreview(orderItemId, authContext, options)`.
- Produces: `resolveFulfillmentPlan()` returns a persisted DTO with `status: BLOCKED` when no valid auto-selection exists.

- [ ] **Step 1: Add failing service tests**

Add cases asserting a blocked preview calls `upsertByOrderItem` once with identity fields, `blockingReasons`, `checks`, and `snapshot.orderItem`; selection IDs, `selectionMode`, `resolvedBy`, and `resolvedAt` remain null. Assert no production trigger occurs. Add a second case proving recheck upserts the same `orderItemId` to `READY` when routing becomes valid.

- [ ] **Step 2: Verify the tests fail**

Run: `npx jest src/test/mapping/services/fulfillmentPlan.service.test.js --runInBand`

Expected: the blocked-plan persistence assertions fail because the current branch returns a preview without an upsert.

- [ ] **Step 3: Add the minimum blocked upsert path**

In `resolveFulfillmentPlan`, replace the blocked early return with one `repository.upsertByOrderItem(orderItemId, {...})`. Reuse `snapshotFrom` inputs with null vendor values and set:

```js
status: fulfillmentPlanStatuses.BLOCKED,
selectionMode: null,
vendorProductId: null,
vendorCostCenterId: null,
blockingReasons: preview.blockingReasons,
checks: preview.checks,
resolvedBy: null,
resolvedAt: null,
```

Keep order badge updates, but do not append a ready timeline or trigger production.

- [ ] **Step 4: Verify Task 1**

Run:

```powershell
node -c src/modules/mapping/services/fulfillmentPlan.service.js
npx jest src/test/mapping/services/fulfillmentPlan.service.test.js --runInBand
```

Expected: syntax succeeds and the focused suite passes.

---

### Task 2: Serve unmatched and summary from persisted plans

**Files:**
- Modify: `src/modules/mapping/repositories/fulfillmentPlan.repository.js`
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Test: `src/test/mapping/services/fulfillmentPlan.service.test.js`
- Create: `src/test/mapping/repositories/fulfillmentPlan.repository.test.js`

**Interfaces:**
- Produces: `repository.listUnmatched(query)` returns `{ items, pagination: { total, page, limit } }` from one `$facet` aggregation.
- Produces: `repository.summarize(query)` additionally returns blocker counts derived from `blockingReasons`.

- [ ] **Step 1: Add failing repository and service tests**

Repository tests must insert READY and BLOCKED plans and verify shop/channel/date, blocker, stage, age, and free-text filters; stable newest-first pagination; and exact total. Service tests must assert `listUnmatchedOrderItems` and `summarizeMapping` never call `orderPublic.listItems` or `buildPreview` and preserve current response keys.

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
npx jest src/test/mapping/repositories/fulfillmentPlan.repository.test.js src/test/mapping/services/fulfillmentPlan.service.test.js --runInBand
```

Expected: `listUnmatched` is missing and the service still scans order items.

- [ ] **Step 3: Implement one-query unmatched pagination**

Add `listUnmatched(query)` with `$match: { ...buildFilter(query), status: BLOCKED }`, optional `$all`/age/free-text clauses over persisted fields, then:

```js
{ $sort: { updatedAt: -1, _id: -1 } },
{ $facet: {
  items: [{ $skip: skip }, { $limit: limit }],
  total: [{ $count: 'count' }],
} },
```

Map `snapshot.orderItem` plus plan blockers to the existing lightweight unmatched shape. Remove the scan/preview loop from `listUnmatchedOrderItems`.

- [ ] **Step 4: Extend persisted summary aggregation**

Extend the existing `summarize` facet with blocker counters using `$unwind: '$blockingReasons'` and `$group`. In `summarizeMapping`, map those exact counts to `blockedSampleCount`, `missingSkuConfigCount`, `missingSemanticRuleCount`, `missingVendorProductCount`, `missingVendorCostCenterCount`, and `ambiguousSkuConfigCount`; remove order-item listing and live previews.

- [ ] **Step 5: Verify Task 2**

Run:

```powershell
node -c src/modules/mapping/repositories/fulfillmentPlan.repository.js
node -c src/modules/mapping/services/fulfillmentPlan.service.js
npx jest src/test/mapping/repositories/fulfillmentPlan.repository.test.js src/test/mapping/services/fulfillmentPlan.service.test.js --runInBand
```

Expected: all focused tests pass and neither GET path invokes live resolution.

---

### Task 3: Reduce config-workbench Mongo operations

**Files:**
- Modify: `src/modules/mapping/repositories/mappingNormalizationRule.repository.js`
- Modify: `src/modules/mapping/repositories/mappingSkuConfigRule.repository.js`
- Modify: `src/modules/mapping/repositories/mappingSkuNormalizeRule.repository.js`
- Modify: `src/modules/mapping/repositories/vendorRoutingRule.repository.js`
- Modify: `src/modules/order/repositories/orderItem.repository.js`
- Modify: `src/modules/order/public.js`
- Modify: `src/modules/mapping/services/mappingRule.service.js`
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Test: `src/test/mapping/services/mappingRule.service.test.js`
- Test: `src/test/mapping/services/fulfillmentPlan.service.test.js`
- Test: `src/test/mapping/repositories/mappingSkuConfigRule.repository.test.js`
- Test: `src/test/mapping/repositories/mappingSkuNormalizeRule.repository.test.js`
- Test: `src/test/order/repositories/orderItem.repository.test.js`

**Interfaces:**
- Produces: each repository `list(query)` keeps `{ items, pagination }` but uses one aggregation.
- Produces: `mappingNormalizationRule.repository.listGrouped(query)` returns `{ semanticRules, valueAliases }`, each with the same paginated shape.
- Produces: `mappingRuleService.listNormalizationRuleGroups(query, authContext)` applies existing access rules once.

- [ ] **Step 1: Add failing aggregation and grouped-query tests**

Assert each `list()` issues one aggregate with `$match`, `$sort`, and `$facet`. Assert grouped normalization returns LABEL rows as `semanticRules` and VALUE rows with non-empty `normalizedValue` as `valueAliases`. Assert workbench calls the grouped service once and keeps its response contract.

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
npx jest src/test/mapping/repositories src/test/order/repositories/orderItem.repository.test.js src/test/mapping/services/mappingRule.service.test.js src/test/mapping/services/fulfillmentPlan.service.test.js --runInBand
```

Expected: tests observe separate `find`/`countDocuments` calls and two normalization service calls.

- [ ] **Step 3: Replace find/count pairs with `$facet`**

For the four Mapping rule repositories and `orderItem.repository.list`, preserve current filters and sort order, then use:

```js
Model.aggregate([
  { $match: filter },
  { $sort: sort },
  { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'count' }] } },
])
```

Normalize the empty aggregation result to `{ items: [], pagination: { total: 0, page, limit } }`.

- [ ] **Step 4: Group semantic and value-alias reads**

Add one normalization repository aggregation whose `$facet` contains `semanticRules` and `valueAliases`. Expose it through the existing Mapping service and replace the two workbench calls with the grouped result. Do not add a generic repository abstraction.

- [ ] **Step 5: Verify Task 3 and architecture**

Run:

```powershell
node -c src/modules/mapping/repositories/mappingNormalizationRule.repository.js
node -c src/modules/mapping/repositories/mappingSkuConfigRule.repository.js
node -c src/modules/mapping/repositories/mappingSkuNormalizeRule.repository.js
node -c src/modules/mapping/repositories/vendorRoutingRule.repository.js
node -c src/modules/order/repositories/orderItem.repository.js
npx jest src/test/mapping/repositories src/test/order/repositories/orderItem.repository.test.js src/test/mapping/services/mappingRule.service.test.js src/test/mapping/services/fulfillmentPlan.service.test.js --runInBand
npm run test:architecture -- --runInBand
```

Expected: focused suites and all architecture contracts pass.

---

### Task 4: Backfill historical order items and benchmark

**Files:**
- Create: `src/modules/mapping/scripts/backfillFulfillmentPlans.js`
- Modify: `package.json`
- Create: `src/test/mapping/scripts/backfillFulfillmentPlans.test.js`
- Use: existing local k6 Mapping benchmark scripts

**Interfaces:**
- Produces: `backfillFulfillmentPlans({ dryRun, batchSize, limit })` returns `{ database, dryRun, totalOrderItems, existingPlans, missingPlans, processed, createdOrUpdated, failures }`.

- [ ] **Step 1: Add a failing idempotency test**

Mock `orderPublic.listItems`, `mappingPublic.listFulfillmentPlansByOrderItemIds`, and `mappingPublic.recheckFulfillmentPlan`. Verify dry-run performs no recheck, write mode rechecks only missing IDs in bounded batches, failures do not stop later items, and a second run reports zero missing.

- [ ] **Step 2: Verify the test fails**

Run: `npx jest src/test/mapping/scripts/backfillFulfillmentPlans.test.js --runInBand`

Expected: module not found.

- [ ] **Step 3: Implement the idempotent script**

Parse `--dry-run=true|false`, `--batch-size=N`, and `--limit=N`; connect through the existing database config; page order items through `order/public`; check plans through `mapping/public`; and call `mappingPublic.recheckFulfillmentPlan` only for missing plans. Print JSON proof including `mongoose.connection.db.databaseName`. Add one npm script entry; do not import foreign models.

- [ ] **Step 4: Verify dry-run target before writing**

Run the new npm script with dry-run. Expected database: `lng_web_be`. Record total, existing, and missing counts. Stop if the database name differs.

- [ ] **Step 5: Run the approved local write and prove coverage**

Run with `--dry-run=false`, then rerun dry-run. Expected: no deletion, failures empty, and `missingPlans: 0` after the write.

- [ ] **Step 6: Run final regression and performance checks**

Run focused Mapping tests, architecture tests, then k6 at 1/5/10/20 VUs for:

```text
/api/mapping/order-items/unmatched?limit=50
/api/mapping/summary
/api/mapping/config-workbench
```

Report p95, error rate, and Mongo operation counts. Do not claim the full suite passed unless it is rerun after these changes.

