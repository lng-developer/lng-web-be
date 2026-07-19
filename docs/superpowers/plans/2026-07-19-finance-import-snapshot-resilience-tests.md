# Finance Import Snapshot Resilience Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one finance E2E contract suite that proves imported fee and refund rows create accurate, idempotent seller-profit snapshots only after manual recalculation.

**Architecture:** Compose the two existing services directly with mocked public ports and an in-memory `financeImport.repository` state store. `financeImport.service` writes through the mock's production-shaped upsert methods; `financeSnapshot.service` reads the same state through its existing `sumFeesByOrderItem()` and `sumRefundsByOrderItem()` calls. No production module, database schema, or route changes are part of this plan.

**Tech Stack:** Node.js, CommonJS, Jest, existing finance services and public ports.

## Global Constraints

- Store and assert all monetary values as integer minor units; never use floating-point expectations.
- Exercise the existing `importTransactions()` and `recalculateOrderItem()` functions; do not duplicate their calculations in test helpers.
- Source identity is `shopId + salesChannelCode + marketplaceCode + sourceRef + rawReference.importKey`; the plan tests idempotency only for the same source reference.
- Use only module public ports for order, mapping, shipment, auth, and organization dependencies.
- Do not add automatic recalculation, cross-source deduplication, reconciliation, live file calls, Mongo setup, or production code unless a failing regression test proves a specific defect.
- Keep execution task-by-task with review after each task. Do not commit on `develop` without explicit user approval.

---

### Task 1: Build the Shared Finance Contract Harness

**Files:**
- Create: `src/test/e2e/financeImportSnapshotFlow.e2e.test.js`

**Interfaces:**
- Consumes: `financeImportService.importTransactions(text, context, authContext)` and `financeSnapshotService.recalculateOrderItem(orderItemId, authContext)`.
- Produces: A shared in-memory source store where finance import upserts are visible to snapshot summation.

- [x] **Step 1: Add public-port and repository mocks before importing either service.**

```js
jest.mock('../../modules/order/public', () => ({
  findItemByFinanceIdentity: jest.fn(),
  findItemById: jest.fn(),
}));
jest.mock('../../modules/mapping/public', () => ({ getFulfillmentPlanForOrderItem: jest.fn() }));
jest.mock('../../modules/shipment/public', () => ({ getShipmentByOrderItem: jest.fn() }));
jest.mock('../../modules/auth/public', () => ({ canAccessScope: jest.fn(), findProfileByEmployeeCode: jest.fn() }));
jest.mock('../../modules/organization/public', () => ({ listAccountOrganizationSummaries: jest.fn() }));
jest.mock('../../modules/finance/repositories/financeSnapshot.repository', () => ({ upsertByOrderItem: jest.fn() }));
jest.mock('../../modules/finance/repositories/financeImport.repository', () => ({
  sumFeesByOrderItem: jest.fn(),
  sumRefundsByOrderItem: jest.fn(),
  upsertFeeLine: jest.fn(),
  upsertLedgerLine: jest.fn(),
  upsertRefundRecord: jest.fn(),
}));

const orderPublic = require('../../modules/order/public');
const mappingPublic = require('../../modules/mapping/public');
const shipmentPublic = require('../../modules/shipment/public');
const authPublic = require('../../modules/auth/public');
const snapshotRepository = require('../../modules/finance/repositories/financeSnapshot.repository');
const financeImportRepository = require('../../modules/finance/repositories/financeImport.repository');
const financeImportService = require('../../modules/finance/services/financeImport.service');
const financeSnapshotService = require('../../modules/finance/services/financeSnapshot.service');
```

- [x] **Step 2: Create the fixed item, plan, context, CSV, and per-test state reset.**

```js
const orderId = '660000000000000000140001';
const orderItemId = '660000000000000000140002';
const shopId = '660000000000000000140003';
const planId = '660000000000000000140004';
const snapshotId = '660000000000000000140099';
const writeAuth = { permissions: ['FINANCE:WRITE'] };
const context = {
  shopId,
  salesChannelCode: 'AMAZON',
  marketplaceCode: 'AMAZON_US',
  sourceRef: 'transaction.csv',
};
const item = {
  _id: orderItemId,
  orderId,
  shopId,
  salesChannelCode: 'AMAZON',
  marketplaceCode: 'AMAZON_US',
  sku: 'SKU-1',
  price: { itemPriceAmount: 5000, shippingPriceAmount: 0, currency: 'USD' },
  externalData: { finance: { feeAmount: 999, refundAmount: 888 } },
};
const transactionCsv = [
  '"date/time","settlement id","type","order id","sku","selling fees","other transaction fees","total"',
  '"Apr 15, 2026 3:48:00 AM PDT","262","Order","114-1","SKU-1","-3.25","-1.00","48.03"',
  '"Apr 16, 2026 3:48:00 AM PDT","262","Refund","114-1","SKU-1","0","0","-10.00"',
].join('\n');
```

Use maps keyed by the production upsert identity. Configure the mocked repository after imports so both services share the same state:

```js
const feeStore = new Map();
const refundStore = new Map();
const ledgerStore = new Map();

function sourceKey(payload) {
  return [
    payload.shopId,
    payload.salesChannelCode,
    payload.marketplaceCode,
    payload.sourceRef,
    payload.rawReference.importKey,
  ].join('|');
}

function sumForOrderItem(store, orderItemId, amountKey) {
  const values = [...store.values()].filter((row) => String(row.orderItemId) === String(orderItemId));
  return values.length ? values.reduce((total, row) => total + row[amountKey], 0) : null;
}

beforeEach(() => {
  jest.resetAllMocks();
  feeStore.clear();
  refundStore.clear();
  ledgerStore.clear();
  orderPublic.findItemByFinanceIdentity.mockResolvedValue(item);
  orderPublic.findItemById.mockResolvedValue(item);
  mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
    id: planId,
    costEstimate: { totalAmount: 2000, lines: [{ code: 'BASE_COST', amount: 2000 }] },
  });
  shipmentPublic.getShipmentByOrderItem.mockResolvedValue(null);
  authPublic.findProfileByEmployeeCode.mockResolvedValue(null);
  financeImportRepository.upsertLedgerLine.mockImplementation(async (payload) => ledgerStore.set(sourceKey(payload), payload));
  financeImportRepository.upsertFeeLine.mockImplementation(async (payload) => feeStore.set(sourceKey(payload), payload));
  financeImportRepository.upsertRefundRecord.mockImplementation(async (payload) => refundStore.set(payload.externalRefundId, payload));
  financeImportRepository.sumFeesByOrderItem.mockImplementation(async (id) => sumForOrderItem(feeStore, id, 'totalFeeAmount'));
  financeImportRepository.sumRefundsByOrderItem.mockImplementation(async (id) => sumForOrderItem(refundStore, id, 'totalRefundAmount'));
  snapshotRepository.upsertByOrderItem.mockImplementation(async (_id, payload) => ({ _id: snapshotId, ...payload }));
});
```

- [x] **Step 3: Run the current finance baseline.**

Run: `npm test -- --runInBand src/test/finance/services/financeImport.service.test.js src/test/finance/services/financeSnapshot.service.test.js`

Expected: PASS before adding the cross-service regression tests.

### Task 2: Prove Imported Money Overrides Fallback Only After Recalculation

**Files:**
- Modify: `src/test/e2e/financeImportSnapshotFlow.e2e.test.js`

**Interfaces:**
- Consumes: The shared source store from Task 1.
- Produces: Cross-service assertions for minor-unit arithmetic and explicit recalculate behavior.

- [x] **Step 1: Add the failing import-to-snapshot test.**

```js
test('uses imported fee and refund minor units only after manual recalculation', async () => {
  await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);

  expect(snapshotRepository.upsertByOrderItem).not.toHaveBeenCalled();

  const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

  expect(snapshot.revenue).toMatchObject({
    customerPaidAmount: 5000,
    feeAmount: 425,
    refundAmount: 1000,
  });
  expect(snapshot.margin).toMatchObject({ grossProfitAmount: 1575 });
});
```

- [x] **Step 2: Run the test to verify the contract.**

Run: `npm test -- --runInBand src/test/e2e/financeImportSnapshotFlow.e2e.test.js -t "uses imported fee"`

Expected: PASS when the harness sums source rows as the repository contract defines. If it fails because the service calculation is wrong, stop and create a production bug-fix plan.

- [x] **Step 3: Review monetary assertions.**

Confirm the test asserts `425`, `1000`, and `1575` exactly, with no decimal conversion or tolerance matcher.

### Task 3: Add Idempotency, Dry-Run, and Unlinked-Row Contracts

**Files:**
- Modify: `src/test/e2e/financeImportSnapshotFlow.e2e.test.js`

**Interfaces:**
- Consumes: The Task 1 state store and Task 2 service flow.
- Produces: Regression coverage that prevents duplicated or cross-item seller-profit distortion.

- [x] **Step 1: Add same-source re-import idempotency coverage.**

```js
test('does not multiply source totals when the same source is imported twice', async () => {
  await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);
  await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);

  const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

  expect(feeStore.size).toBe(2);
  expect(refundStore.size).toBe(1);
  expect(snapshot.revenue).toMatchObject({ feeAmount: 425, refundAmount: 1000 });
  expect(snapshot.margin.grossProfitAmount).toBe(1575);
});
```

- [x] **Step 2: Add dry-run isolation coverage.**

```js
test('does not persist source rows or alter a snapshot for a dry-run import', async () => {
  await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: true }, writeAuth);

  const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

  expect(feeStore.size).toBe(0);
  expect(refundStore.size).toBe(0);
  expect(snapshot.revenue).toMatchObject({ feeAmount: 999, refundAmount: 888 });
});
```

- [x] **Step 3: Add unlinked-row isolation coverage.**

```js
test('does not include unlinked imported rows in a linked item snapshot', async () => {
  orderPublic.findItemByFinanceIdentity.mockResolvedValue(null);
  await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);

  const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

  expect(snapshot.revenue).toMatchObject({ feeAmount: 999, refundAmount: 888 });
  expect(snapshot.margin.grossProfitAmount).toBe(1113);
});
```

- [x] **Step 4: Run the E2E finance contract suite.**

Run: `npm test -- --runInBand src/test/e2e/financeImportSnapshotFlow.e2e.test.js`

Expected: PASS with five tests. Each test resets its stores; source rows from one test must never reach another.

### Task 4: Preserve Existing Missing-Cost Semantics

**Files:**
- Modify: `src/test/e2e/financeImportSnapshotFlow.e2e.test.js`

**Interfaces:**
- Consumes: Imported source totals and `financeSnapshotService.recalculateOrderItem()`.
- Produces: A guard against showing a fabricated seller profit when fulfillment cost is unavailable.

- [x] **Step 1: Add the missing-cost contract.**

```js
test('keeps profit and margin null when imported money exists but fulfillment cost is missing', async () => {
  mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({ id: planId });
  await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);

  const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

  expect(snapshot.revenue).toMatchObject({ feeAmount: 425, refundAmount: 1000 });
  expect(snapshot).toMatchObject({ snapshotStatus: 'MISSING_COST' });
  expect(snapshot.margin).toEqual({ grossProfitAmount: null, grossMarginBps: null });
});
```

- [x] **Step 2: Run the missing-cost test.**

Run: `npm test -- --runInBand src/test/e2e/financeImportSnapshotFlow.e2e.test.js -t "keeps profit and margin null"`

Expected: PASS. A value of zero is incorrect because missing cost is unknown, not free.

### Task 5: Verify the Finance Regression Slice

**Files:**
- Verify: `src/test/e2e/financeImportSnapshotFlow.e2e.test.js`
- Verify: `src/test/finance/services/financeImport.service.test.js`
- Verify: `src/test/finance/services/financeSnapshot.service.test.js`
- Verify: `src/test/finance/routes/index.test.js`

**Interfaces:**
- Consumes: Completed finance import-to-snapshot regression tests.
- Produces: Fresh evidence that the new cross-service checks coexist with current import, snapshot, and HTTP behavior.

- [x] **Step 1: Run all narrow finance suites.**

Run: `npm test -- --runInBand src/test/e2e/financeImportSnapshotFlow.e2e.test.js src/test/finance/services/financeImport.service.test.js src/test/finance/services/financeSnapshot.service.test.js src/test/finance/routes/index.test.js`

Expected: PASS with no live database or network calls.

- [x] **Step 2: Run architecture verification.**

Run: `npm run test:architecture -- --runInBand`

Expected: PASS. The test must use only module public ports for cross-module dependencies.

- [x] **Step 3: Inspect the scoped diff.**

Run: `git diff --check; git diff -- src/test/e2e/financeImportSnapshotFlow.e2e.test.js`

If the E2E test is untracked, also run `git status --short -- src/test/e2e/financeImportSnapshotFlow.e2e.test.js` and `git diff --no-index -- NUL src/test/e2e/financeImportSnapshotFlow.e2e.test.js`; exit code `1` is expected for the no-index comparison. Report only this scoped evidence because the worktree is pre-existing dirty. No production money calculation or credentials may be intentionally introduced by this slice.

## Plan Self-Review

- Spec coverage: Tasks 2-4 cover imported-money arithmetic, same-source idempotency, dry-run isolation, unlinked rows, manual recalculation, and missing-cost behavior.
- Scope: The plan creates one test file only and uses existing service contracts; it excludes reconciliation and live integrations.
- Consistency: Every assertion is expressed in integer minor units and calculates profit as `5000 - 425 - 1000 - 2000 = 1575`.
