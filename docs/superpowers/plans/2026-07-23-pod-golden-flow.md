# POD Golden Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove supported import, fulfillment, shipment, and finance behavior through one repeatable E2E contract with replay and recovery coverage.

**Architecture:** Extend the existing `orderFulfillmentFlow.e2e.test.js`; reuse real services with in-memory repository/public-port mocks at external boundaries. Do not add an orchestrator or production behavior unless a failing replay/recovery assertion demonstrates a real contract gap.

**Tech Stack:** Node.js CommonJS, Jest 30, existing module public ports.

## Global Constraints

- CI and Test Baseline must be green first.
- Supported sources remain `AMAZON_EXTENSION_REPORT` and `MANUAL_EXCEL`.
- Cross-module production calls must use `public.js`.
- No live vendor, Redis, MongoDB, or storage request in Jest.

---

### Task 1: Add the Canonical Import Fixture

**Files:**
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`
- Reference: `src/modules/integration/externalOrderImport/sources/manualExcel/amazonOrderReport.mapper.js`
- Reference: `src/modules/order/services/orderImport.service.js`

**Interfaces:**
- Consumes: `orderPublic.importExternalOrder(externalOrderDto)`.
- Produces: stable order/item identities reused by later E2E tasks.

- [ ] **Step 1: Write a failing import identity test**

```js
it('imports one canonical order item with stable external identity', async () => {
  const first = await orderImportService.importExternalOrder(canonicalExternalOrder);
  expect(first.order.externalOrderId).toBe('AMZ-GOLDEN-001');
  expect(first.items).toHaveLength(1);
  expect(first.items[0].externalItemId).toBe('AMZ-GOLDEN-001-1');
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

Expected: FAIL until the fixture and stateful order repository mocks use stable identities.

- [ ] **Step 3: Reuse the existing import mock store**

Make `findByExternalIdentity`, item lookup, create, and update mocks return the same stored entities for:

```js
const canonicalExternalOrder = {
  source: 'AMAZON_EXTENSION_REPORT',
  externalOrderId: 'AMZ-GOLDEN-001',
  shopId,
  items: [{ externalItemId: 'AMZ-GOLDEN-001-1', sku: 'TSHIRT-BLACK-M', quantity: 1 }],
};
```

Fill the remaining required DTO fields by copying the smallest valid values from the existing import test fixture.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

```powershell
git add src/test/e2e/orderFulfillmentFlow.e2e.test.js
git commit -m "test(order): add canonical POD import fixture"
```

### Task 2: Assert the Complete Happy Path

**Files:**
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`

**Interfaces:**
- Consumes: existing mapping, production, vendorSubmission, shipment, and finance services already loaded by the E2E.
- Produces: one linked record at each lifecycle boundary.

- [ ] **Step 1: Add final-state assertions**

Extend the canonical scenario:

```js
expect(fulfillmentPlan.orderItemId).toBe(orderItem.id);
expect(productionTask.orderItemId).toBe(orderItem.id);
expect(vendorSubmission.productionTaskId).toBe(productionTask.id);
expect(shipment.orderItemId).toBe(orderItem.id);
expect(financeSnapshot.orderItemId).toBe(orderItem.id);
expect(financeSnapshot.orderId).toBe(order.id);
```

- [ ] **Step 2: Run and repair only contract-faithful mocks**

Run: `npm test -- src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

Expected: FAIL at the first mock that does not retain a real service output. Update that mock's in-memory store; do not bypass a service guard.

- [ ] **Step 3: Verify architecture and commit**

Run: `npm run test:architecture -- --runInBand`

```powershell
git add src/test/e2e/orderFulfillmentFlow.e2e.test.js
git commit -m "test(e2e): verify POD golden flow"
```

### Task 3: Prove Replay Idempotency

**Files:**
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`

**Interfaces:**
- Consumes: the same canonical input and existing upsert/idempotency contracts.
- Produces: duplicate-count assertions for every lifecycle identity.

- [ ] **Step 1: Write the replay test**

```js
it('replays the canonical flow without duplicate domain records', async () => {
  await runCanonicalFlow();
  await runCanonicalFlow();
  expect(orderStore).toHaveLength(1);
  expect(orderItemStore).toHaveLength(1);
  expect(productionTaskStore).toHaveLength(1);
  expect(vendorSubmissionStore).toHaveLength(1);
  expect(shipmentStore).toHaveLength(1);
  expect(financeSnapshotStore).toHaveLength(1);
});
```

Use existing stores; extract `runCanonicalFlow()` only when two tests genuinely share the full sequence.

- [ ] **Step 2: Run the test**

Run: `npm test -- src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

Expected: PASS if existing identities are correctly mocked; otherwise FAIL at the duplicated owner.

- [ ] **Step 3: Fix a demonstrated production gap, if any**

If a real service lacks idempotency, add the narrowest repository lookup/upsert in that owning module plus a focused module test. Do not add a cross-module coordinator.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

```powershell
git add src/test/e2e/orderFulfillmentFlow.e2e.test.js
git commit -m "test(e2e): cover POD flow replay"
```

### Task 4: Prove Mid-Flow Recovery

**Files:**
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`
- Reference: `src/modules/integration/externalOrderImport/services/postImportMappingProcessor.service.js`
- Reference: `src/modules/integration/externalOrderImport/services/postImportMappingRecoveryScheduler.service.js`

**Interfaces:**
- Consumes: existing post-import mapping recovery entrypoint.
- Produces: recovery assertion after one transient mapping failure.

- [ ] **Step 1: Inject one failure**

```js
mappingPublic.getFulfillmentPlanForOrderItem
  .mockRejectedValueOnce(Object.assign(new Error('temporary mapping outage'), { code: 'TEMPORARY_FAILURE' }))
  .mockImplementation((...args) => mockMappingService.getFulfillmentPlanForOrderItem(...args));
```

- [ ] **Step 2: Assert persistence then recovery**

```js
await expect(runCanonicalFlow()).rejects.toMatchObject({ code: 'TEMPORARY_FAILURE' });
expect(orderStore).toHaveLength(1);
await runSupportedPostImportRecovery();
expect(financeSnapshotStore).toHaveLength(1);
expect(orderStore).toHaveLength(1);
```

- [ ] **Step 3: Run related suites**

Run: `npm test -- src/test/e2e src/test/integration/externalOrderImport --runInBand`

Expected: PASS.

- [ ] **Step 4: Run full verification and commit**

Run: `npm test -- --runInBand`

```powershell
git add src/test/e2e/orderFulfillmentFlow.e2e.test.js
git commit -m "test(e2e): verify POD recovery path"
```
