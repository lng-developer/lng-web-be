# Order Workbench Read Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fully expanded Order Workbench fast for growing order volume while preserving fresh data after the next browser refresh.

**Architecture:** Phase 1's scheduler experiment was rejected after higher concurrent Atlas fan-out regressed local latency. Phase 2 introduces an Order-owned `OrderWorkbenchProjection`, a compact row compatible with the current Workbench DTO input, updated synchronously by narrow public-port calls after source writes; the Workbench endpoint will read the indexed projection without cross-module enrichment after parity verification.

**Tech Stack:** Node.js, Express, CommonJS, MongoDB/Mongoose, Jest, React/TypeScript consumer contract.

**Spec:** `docs/superpowers/specs/2026-09-03-order-workbench-read-performance-design.md`

## Global Constraints

- Preserve the `GET /api/orders/workbench` response DTO and existing query parameters.
- Keep complete expanded rows; no UI lazy loading and no TTL cache as the source of truth.
- Cross-module calls use only public ports; never import another module's internal model, repository, service, controller, or DTO.
- Source writes await their projection update before returning success.
- Projection values are compact DTO/read-model fields only; never persist raw source records, private URLs, or large assets.
- Backfill/repair must be idempotent, batched, read-back verified, and must report the target database before a write.
- Do not commit unless the user explicitly requests a commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/modules/order/services/orderQuery.service.js` | Phase 1 dependency-aware enrichment and Phase 2 projection-backed Workbench read selection. |
| `src/modules/order/models/orderWorkbenchProjection.model.js` | One compact, indexed projection document per Order. |
| `src/modules/order/repositories/orderWorkbenchProjection.repository.js` | Indexed list/count, atomic order patch, and atomic item-field patch operations. |
| `src/modules/order/services/orderWorkbenchProjection.service.js` | Projection construction, source patch validation, merge/update operations, backfill/repair helpers. |
| `src/modules/order/dtos/orderWorkbenchProjection.dto.js` | Internal compact projection-to-Workbench adapter, preserving the existing response shape. |
| `src/modules/order/public.js` | Public projection update and repair ports used by source modules. |
| Source services in Order, Customization, Mapping, Production, and Shipment | Await narrow projection updates after their existing successful writes. |
| `src/modules/order/scripts/backfillOrderWorkbenchProjections.js` | Explicit, idempotent bounded backfill command. |
| `src/modules/order/scripts/verifyOrderWorkbenchProjections.js` | Read-only projection parity command. |
| `tests/order/...` | Unit, repository, contract, and source-write synchronization coverage. |

## Task 1: Establish a reproducible Phase 1 latency baseline

**Files:**
- Modify: `src/modules/order/services/orderQuery.service.js:327-354`
- Test: `tests/order/services/orderQuery.service.test.js`
- Test: `tests/order/repositories/order.repository.test.js`

**Interfaces:**
- Consumes: `listOrderWorkbench(query, authContext)` and existing `slow_order_workbench_request` logging.
- Produces: stable stage duration names and a testable performance dependency graph.

- [ ] **Step 1: Write failing tests for stage names and response parity**

```js
expect(logger.warn).toHaveBeenCalledWith('slow_order_workbench_request', expect.objectContaining({
  data: expect.objectContaining({
    stageDurations: expect.objectContaining({ orders: expect.any(Number) }),
  }),
}));
expect(result).toEqual(expect.objectContaining({ items: expect.any(Array), total: 1, page: 1, limit: 20 }));
```

- [ ] **Step 2: Run the focused test and confirm it fails for the new timing contract**

Run: `npx jest tests/order/services/orderQuery.service.test.js --runInBand`

Expected: FAIL because the new stage contract is absent.

- [ ] **Step 3: Keep telemetry structured and add no request cache**

Keep `warnIfWorkbenchSlow` as the single logging point. Add only deterministic stage names used by later tests; do not log order customer data, raw customizations, or URLs.

```js
const stageDurations = { orders: 0, enrichments: {}, postEnrichments: {} };
```

- [ ] **Step 4: Run focused tests and syntax check**

Run: `npx jest tests/order/services/orderQuery.service.test.js --runInBand; node -c src/modules/order/services/orderQuery.service.js`

Expected: PASS.

## Task 2: Make the assembled Workbench dependency-aware

**Files:**
- Modify: `src/modules/order/services/orderQuery.service.js:442-509`
- Test: `tests/order/services/orderQuery.service.test.js`

**Interfaces:**
- Consumes: existing `listItemFulfillmentPlans`, `listItemListings`, `listItemListingVariants`, `runWithConcurrency`, and `measureWorkbenchStage`.
- Produces: `listOrderWorkbench` with identical result shape and lower critical-path wait time.

- [ ] **Step 1: Write a failing ordering test**

Use deferred promises so fulfillment resolves before a deliberately slow customization call. Assert the Listing request starts when fulfillment resolves, not when all independent enrichments resolve.

```js
fulfillmentPlans.resolve(new Map([[itemId, plan]]));
await Promise.resolve();
expect(catalogPublic.getListingSummariesByIds).toHaveBeenCalledWith([listingId]);
expect(customizationPublic.listOrderItemCustomizationViews).not.toHaveBeenResolved();
```

- [ ] **Step 2: Run the test and confirm the current queue waits too long**

Run: `npx jest tests/order/services/orderQuery.service.test.js -t "starts listing enrichment" --runInBand`

Expected: FAIL because Listing begins only after the existing `runWithConcurrency` result is awaited.

- [ ] **Step 3: Start dependent work from its prerequisite promise**

Keep every existing batch call and authorization path. Start independent calls with a named bounded concurrency constant, and derive Listing/Variant promises directly from fulfillment-plan completion.

```js
const fulfillmentPlansPromise = measureWorkbenchStage(
  stageDurations.enrichments,
  'fulfillmentPlans',
  () => listItemFulfillmentPlans(orderItemIds, authContext),
);
const listingPromise = fulfillmentPlansPromise.then((plans) => measureWorkbenchStage(
  stageDurations.enrichments,
  'listings',
  () => listItemListings(allItems, [...plans.values()]),
));
```

Do not increase concurrency blindly. Set the initial value to `5`, add it as a local named constant, and retain the benchmark gate in Task 11.

- [ ] **Step 4: Run focused tests**

Run: `npx jest tests/order/services/orderQuery.service.test.js --runInBand`

Expected: PASS with identical items, order, pagination, and authorization behavior.

## Task 3: Add the Order-owned projection schema and repository

**Files:**
- Create: `src/modules/order/models/orderWorkbenchProjection.model.js`
- Create: `src/modules/order/repositories/orderWorkbenchProjection.repository.js`
- Test: `tests/order/models/orderWorkbenchProjection.model.test.js`
- Test: `tests/order/repositories/orderWorkbenchProjection.repository.test.js`

**Interfaces:**
- Produces:

```js
findPage(query): Promise<{ items, total, page, limit }>;
upsertBase(orderProjection, options): Promise<object>;
setOrderFields(orderId, patch, options): Promise<object | null>;
setItemFields(orderId, orderItemId, patch, options): Promise<object | null>;
```

- [ ] **Step 1: Write failing schema/index tests**

```js
expect(OrderWorkbenchProjection.schema.indexes()).toEqual(expect.arrayContaining([
  [expect.objectContaining({ shopId: 1, orderedAt: -1, _id: -1 }), expect.any(Object)],
  [expect.objectContaining({ shopId: 1, status: 1, orderedAt: -1, _id: -1 }), expect.any(Object)],
]));
```

- [ ] **Step 2: Write failing repository tests for atomic patches**

```js
await repository.setItemFields(orderId, orderItemId, { production: { qcStatus: 'APPROVED' } });
expect(Model.findOneAndUpdate).toHaveBeenCalledWith(
  { orderId },
  { $set: { 'items.$[item].production': { qcStatus: 'APPROVED' } } },
  expect.objectContaining({ arrayFilters: [{ 'item.orderItemId': orderItemId }] }),
);
```

- [ ] **Step 3: Implement the compact schema**

Use `orderId` as a unique indexed source identity and an `items` array with a required `orderItemId`. Define only view fields required by `toOrderWorkbenchDto`; define nested `Mixed` fields only for already-sanitized compact source views. Add `projectionUpdatedAt` and `sourceVersions` only if used by merge tests.

```js
orderWorkbenchProjectionSchema.index({ orderId: 1 }, { unique: true });
orderWorkbenchProjectionSchema.index({ shopId: 1, orderedAt: -1, _id: -1 });
orderWorkbenchProjectionSchema.index({ shopId: 1, status: 1, orderedAt: -1, _id: -1 });
```

- [ ] **Step 4: Implement repository pagination and atomic patches**

Use `.lean()` for reads. Build filters from the existing Order Workbench query semantics. Use `$set` plus `arrayFilters` for source-specific nested fields so concurrent Customization and Production writes cannot overwrite each other.

- [ ] **Step 5: Run narrow tests and syntax checks**

Run: `npx jest tests/order/models/orderWorkbenchProjection.model.test.js tests/order/repositories/orderWorkbenchProjection.repository.test.js --runInBand; node -c src/modules/order/models/orderWorkbenchProjection.model.js; node -c src/modules/order/repositories/orderWorkbenchProjection.repository.js`

Expected: PASS.

## Task 4: Implement projection construction and Order public ports

**Files:**
- Create: `src/modules/order/services/orderWorkbenchProjection.service.js`
- Create: `src/modules/order/dtos/orderWorkbenchProjection.dto.js`
- Modify: `src/modules/order/public.js`
- Test: `tests/order/services/orderWorkbenchProjection.service.test.js`
- Test: `tests/order/dtos/orderWorkbenchProjection.dto.test.js`

**Interfaces:**
- Produces:

```js
upsertOrderWorkbenchBase(order, items, { session }): Promise<object>;
updateOrderWorkbenchOrder(orderId, patch, { session, source }): Promise<object | null>;
updateOrderWorkbenchItem(orderId, orderItemId, patch, { session, source }): Promise<object | null>;
toOrderWorkbenchRow(projection): object;
```

- [ ] **Step 1: Write failing projection merge tests**

```js
await service.updateOrderWorkbenchItem(orderId, itemId, {
  customization: { status: 'PARSED' },
}, { source: 'CUSTOMIZATION' });
await service.updateOrderWorkbenchItem(orderId, itemId, {
  production: { qcStatus: 'APPROVED' },
}, { source: 'PRODUCTION' });
expect(repository.setItemFields).toHaveBeenNthCalledWith(2, orderId, itemId, {
  production: { qcStatus: 'APPROVED' },
}, expect.any(Object));
```

- [ ] **Step 2: Write failing DTO parity tests**

Build a projection fixture matching an existing Workbench fixture and assert `toOrderWorkbenchRow` produces the same order/item fields consumed by `toOrderWorkbenchDto`.

- [ ] **Step 3: Implement source patch validation**

Accept only these top-level item patch keys: `seller`, `listing`, `customization`, `fulfillmentPlan`, `listingVariant`, `production`, and `tracking`. Accept only `case` at order level. Reject unexpected fields with `AppError(VALIDATION_ERROR)` to prevent raw source payload persistence.

- [ ] **Step 4: Implement base projection creation**

The Order module builds base order/item fields from existing normalized Order and OrderItem data. It must preserve the original item order and use `upsertBase` before any item field patch is allowed.

- [ ] **Step 5: Export only public ports**

```js
updateOrderWorkbenchItem: projectionService.updateOrderWorkbenchItem,
updateOrderWorkbenchOrder: projectionService.updateOrderWorkbenchOrder,
upsertOrderWorkbenchBase: projectionService.upsertOrderWorkbenchBase,
```

- [ ] **Step 6: Run focused tests**

Run: `npx jest tests/order/services/orderWorkbenchProjection.service.test.js tests/order/dtos/orderWorkbenchProjection.dto.test.js --runInBand`

Expected: PASS.

## Task 5: Keep the endpoint contract while adding projection read selection

**Files:**
- Modify: `src/modules/order/services/orderQuery.service.js`
- Modify: `src/modules/order/dtos/order.dto.js`
- Test: `tests/order/services/orderQuery.service.test.js`
- Test: `tests/order/dtos/order.dto.test.js`

**Interfaces:**
- Consumes: `orderWorkbenchProjectionService.listWorkbench(query, authContext)` and `toOrderWorkbenchRow`.
- Produces: the unchanged `listOrderWorkbench` return shape.

- [ ] **Step 1: Write failing endpoint-service contract tests**

```js
projectionService.listWorkbench.mockResolvedValue({ items: [projection], total: 1, page: 1, limit: 20 });
const result = await queryService.listOrderWorkbench({ page: 1, limit: 20, tab: 'ALL' }, globalReadAuth);
expect(result).toEqual({ items: [existingWorkbenchRow], total: 1, page: 1, limit: 20 });
expect(customizationPublic.listOrderItemCustomizationViews).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the test and confirm the old assembler is still selected**

Run: `npx jest tests/order/services/orderQuery.service.test.js -t "projection-backed workbench" --runInBand`

Expected: FAIL.

- [ ] **Step 3: Add an explicit read-source switch with safe default**

Read projections only when `ORDER_WORKBENCH_PROJECTION_READ=true`. Default to the current assembler until Task 10 parity verification is clean. Do not expose this flag to HTTP clients.

- [ ] **Step 4: Preserve scope filtering and tab semantics in projection repository**

Reuse Order access constraints to add `shopIds`/assigned-staff constraints before the repository read. Assert every tab filter is represented by projection fields before enabling that tab on projection reads.

- [ ] **Step 5: Run contract tests**

Run: `npx jest tests/order/services/orderQuery.service.test.js tests/order/dtos/order.dto.test.js --runInBand`

Expected: PASS; response DTO is unchanged.

## Task 6: Synchronize Order-owned mutations and case changes

**Files:**
- Modify: `src/modules/order/services/orderItemStatusTransition.service.js`
- Modify: `src/modules/order/services/orderCase.service.js`
- Modify: `src/modules/order/services/orderAddressValidation.service.js`
- Modify: `src/modules/order/services/orderCostCenterStatus.service.js`
- Test: `tests/order/services/orderItemStatusTransition.service.test.js`
- Test: `tests/order/services/orderCase.service.test.js`

**Interfaces:**
- Consumes: `upsertOrderWorkbenchBase`, `updateOrderWorkbenchOrder`, `updateOrderWorkbenchItem` from the local Order service/public port.
- Produces: base/order/case state that is visible after the source write resolves.

- [ ] **Step 1: Write failing tests for each Order mutation**

```js
expect(projectionService.updateOrderWorkbenchOrder).toHaveBeenCalledWith(orderId, {
  case: expect.objectContaining({ status: 'OPEN' }),
}, expect.objectContaining({ source: 'ORDER_CASE' }));
```

- [ ] **Step 2: Run the two focused suites and confirm no projection update occurs**

Run: `npx jest tests/order/services/orderItemStatusTransition.service.test.js tests/order/services/orderCase.service.test.js --runInBand`

Expected: FAIL for the new assertions.

- [ ] **Step 3: Patch projections after successful source writes**

Pass the active transaction `session` when one exists. Await the projection update after the source repository update and before returning the service result. Preserve existing audit/timeline behavior.

- [ ] **Step 4: Run focused suites**

Run: `npx jest tests/order/services/orderItemStatusTransition.service.test.js tests/order/services/orderCase.service.test.js --runInBand`

Expected: PASS.

## Task 7: Synchronize Customization and Mapping writes

**Files:**
- Modify: `src/modules/customization/services/customizationPayload.service.js`
- Modify: `src/modules/customization/services/customizationParse.service.js`
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Test: `tests/customization/services/customizationPayload.service.test.js`
- Test: `tests/customization/services/customizationParse.service.test.js`
- Test: `tests/mapping/services/fulfillmentPlan.service.test.js`

**Interfaces:**
- Consumes: `orderPublic.updateOrderWorkbenchItem(orderId, orderItemId, patch, context)`.
- Produces: sanitized `customization` and `fulfillmentPlan` projection fields.

- [ ] **Step 1: Write failing source synchronization tests**

```js
expect(orderPublic.updateOrderWorkbenchItem).toHaveBeenCalledWith(
  orderId,
  orderItemId,
  { customization: expect.objectContaining({ status: 'PARSED' }) },
  expect.objectContaining({ source: 'CUSTOMIZATION' }),
);
```

- [ ] **Step 2: Run the three focused suites and confirm the calls are absent**

Run: `npx jest tests/customization/services/customizationPayload.service.test.js tests/customization/services/customizationParse.service.test.js tests/mapping/services/fulfillmentPlan.service.test.js --runInBand`

Expected: FAIL for the added assertions.

- [ ] **Step 3: Patch from DTO-safe source views**

Customization sends `toOrderItemCustomizationViewDto(payload)`. Mapping sends `toFulfillmentPlanDto(plan)` plus compact Listing/Variant data already available in its preview/result. Do not pass `rawCustomization`, `assets.sourceUrl`, candidates, or full plan snapshots.

- [ ] **Step 4: Cover blocked and ready mapping outcomes**

Both `resolveFulfillmentPlan` branches must patch projection state. Recheck and manual selection route through this function and therefore must not receive separate duplicated hooks.

- [ ] **Step 5: Run focused suites and architecture check**

Run: `npx jest tests/customization/services/customizationPayload.service.test.js tests/customization/services/customizationParse.service.test.js tests/mapping/services/fulfillmentPlan.service.test.js --runInBand; npm run test:architecture -- --runInBand`

Expected: PASS.

## Task 8: Synchronize Production and Shipment writes

**Files:**
- Modify: `src/modules/production/services/productionTask.service.js`
- Modify: `src/modules/shipment/services/shipment.service.js`
- Modify: `src/modules/shipment/services/shipmentWebhook.service.js`
- Test: `tests/production/services/productionTask.service.test.js`
- Test: `tests/shipment/services/shipment.service.test.js`
- Test: `tests/shipment/services/shipmentWebhook.service.test.js`

**Interfaces:**
- Consumes: `orderPublic.updateOrderWorkbenchItem(orderId, orderItemId, patch, context)`.
- Produces: sanitized Production and Tracking fields synchronized before source write responses complete.

- [ ] **Step 1: Write failing tests for production lifecycle and shipment status updates**

```js
expect(orderPublic.updateOrderWorkbenchItem).toHaveBeenCalledWith(
  orderId,
  orderItemId,
  { production: expect.objectContaining({ qcStatus: 'APPROVED' }) },
  expect.objectContaining({ source: 'PRODUCTION' }),
);
```

- [ ] **Step 2: Run focused suites and confirm the added expectations fail**

Run: `npx jest tests/production/services/productionTask.service.test.js tests/shipment/services/shipment.service.test.js tests/shipment/services/shipmentWebhook.service.test.js --runInBand`

Expected: FAIL for the new assertions.

- [ ] **Step 3: Centralize hooks at common lifecycle functions**

Production hooks belong after the common successful task update helper, not once per controller action. Shipment hooks belong in `shipment.service.updateStatus`; webhook paths already delegate there and must not double-write the projection.

- [ ] **Step 4: Run focused suites**

Run: `npx jest tests/production/services/productionTask.service.test.js tests/shipment/services/shipment.service.test.js tests/shipment/services/shipmentWebhook.service.test.js --runInBand`

Expected: PASS.

## Task 9: Add idempotent backfill and read-only parity verification

**Files:**
- Create: `src/modules/order/scripts/backfillOrderWorkbenchProjections.js`
- Create: `src/modules/order/scripts/verifyOrderWorkbenchProjections.js`
- Modify: `package.json`
- Test: `tests/order/scripts/orderWorkbenchProjection.scripts.test.js`

**Interfaces:**
- Produces commands:

```text
npm run backfill:order-workbench -- --shopId <id> --limit 100
npm run verify:order-workbench -- --shopId <id> --limit 100
```

- [ ] **Step 1: Write failing script tests for bounded selection and read-back**

```js
await backfill({ shopId, limit: 2, dryRun: false });
expect(projectionRepository.upsertBase).toHaveBeenCalledTimes(2);
expect(projectionRepository.findByOrderId).toHaveBeenCalledTimes(2);
```

- [ ] **Step 2: Run the script suite and confirm it fails before implementation**

Run: `npx jest tests/order/scripts/orderWorkbenchProjection.scripts.test.js --runInBand`

Expected: FAIL because script modules do not exist.

- [ ] **Step 3: Implement backfill safeguards**

Require an explicit bounded scope (`shopId`, date range, or explicit limit). Print the configured database name without printing its connection string. Default to `dryRun=true`; require `--apply` for writes. For every written batch, reload the projection and compare `orderId` plus item IDs.

- [ ] **Step 4: Implement parity verification**

For each selected order, assemble the current Workbench row through the existing read path and compare only contract fields with its projection-backed row. Emit mismatch counts and identifiers; do not mutate data.

- [ ] **Step 5: Run script tests and syntax checks**

Run: `npx jest tests/order/scripts/orderWorkbenchProjection.scripts.test.js --runInBand; node -c src/modules/order/scripts/backfillOrderWorkbenchProjections.js; node -c src/modules/order/scripts/verifyOrderWorkbenchProjections.js`

Expected: PASS.

## Task 10: Cut over only after parity evidence

**Files:**
- Modify: `src/modules/order/services/orderQuery.service.js`
- Modify: `.env.example`
- Test: `tests/order/services/orderQuery.service.test.js`

**Interfaces:**
- Consumes: `ORDER_WORKBENCH_PROJECTION_READ` and verified projection rows.
- Produces: projection-backed response only when explicitly enabled.

- [ ] **Step 1: Write failing feature-flag tests**

```js
process.env.ORDER_WORKBENCH_PROJECTION_READ = 'true';
await service.listOrderWorkbench(query, authContext);
expect(projectionService.listWorkbench).toHaveBeenCalled();
```

- [ ] **Step 2: Run test to verify feature selection fails**

Run: `npx jest tests/order/services/orderQuery.service.test.js -t "projection read flag" --runInBand`

Expected: FAIL.

- [ ] **Step 3: Implement the flag and document it**

The default remains `false`. Enabling it must preserve authorization, response shape, filters, and empty-result semantics. Do not add the value to version control outside `.env.example`.

- [ ] **Step 4: Run focused Order tests**

Run: `npx jest tests/order --runInBand --forceExit`

Expected: PASS.

## Task 11: Verify database plans, UI behavior, and regression gates

**Files:**
- Modify only if a verification test exposes a defect.
- Test: existing Order, Mapping, Customization, Production, Shipment, and architecture suites.

**Interfaces:**
- Consumes: completed Phase 1 and Phase 2 implementation.
- Produces: evidence-backed cutover decision.

- [ ] **Step 1: Run index explain checks against a bounded non-production scope**

Run the projection page query with `explain('executionStats')`. Confirm the selected shop/sort query uses `{ shopId: 1, orderedAt: -1, _id: -1 }` and record keys/docs examined. Add a tab-specific index only with explain evidence.

- [ ] **Step 2: Backfill a small local scope and run parity verification**

Run: `npm run backfill:order-workbench -- --shopId <local-shop-id> --limit 20 --apply`

Then: `npm run verify:order-workbench -- --shopId <local-shop-id> --limit 20`

Expected: every selected projection is present and parity mismatch count is zero.

- [ ] **Step 3: Run automated gates**

Run: `npm run test:architecture -- --runInBand; npm test -- --runInBand; git diff --check`

Expected: all suites pass and no whitespace errors.

- [ ] **Step 4: Verify in the authenticated local browser**

Open `/portal/orders`, refresh the `ALL` tab, and record Network timing for `/api/orders/workbench`. Perform one safe existing test-state mutation only if an approved non-production fixture exists; otherwise verify synchronization with service tests and report that live mutation was not performed.

- [ ] **Step 5: Report before/after evidence and leave cutover disabled unless parity is clean**

Report Phase 1 timing, projection query timing, test results, backfill scope/counts, parity result, and the exact feature-flag state. Do not claim production deployment or enable the flag without user authorization.
