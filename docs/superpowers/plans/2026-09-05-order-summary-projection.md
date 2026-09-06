# Order Summary Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `GET /api/orders/summary` use the existing workbench projection without returning stale tab counts.

**Architecture:** Keep the response contract unchanged. Rebuild the existing projection from the authoritative order read model, add a narrow guard test for the summary repository selection, then enable the existing projection-read flag after the rebuilt records are verified against source counts.

**Tech Stack:** Node.js, Mongoose, Jest, MongoDB aggregation.

**Spec:** User-approved performance audit on 2026-09-05.

## Global Constraints

- Do not change the HTTP response shape.
- Do not mutate `Order` or `OrderItem`; only upsert `OrderWorkbenchProjection`.
- Preserve unrelated dirty worktree changes.

---

### Task 1: Lock the fast-summary repository choice

**Files:**
- Modify: `tests/order/services/orderQuery.service.test.js`
- Modify: `src/modules/order/services/orderQuery.service.js` only if the test exposes a selection defect.

**Interfaces:**
- Consumes: `getOrderSummary(query, authContext)`.
- Produces: `{ tabCounts }` with the existing DTO contract.

- [ ] **Step 1: Write the failing test**

```js
test('uses projection counts when ORDER_WORKBENCH_PROJECTION_READ is enabled', async () => {
  process.env.ORDER_WORKBENCH_PROJECTION_READ = 'true';
  projectionRepository.countByTabs.mockResolvedValue({ ALL: 2, NEW_ORDER: 1 });

  await service.getOrderSummary({}, { permissions: ['ORDERS:READ'] });

  expect(projectionRepository.countByTabs).toHaveBeenCalledWith({});
  expect(orderRepository.countByTabs).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails only if repository selection is wrong.**

Run: `npm test -- --runInBand tests/order/services/orderQuery.service.test.js`

- [ ] **Step 3: Implement the smallest production change only if required.**

```js
const summaryRepository = process.env.ORDER_WORKBENCH_PROJECTION_READ === 'true'
  ? orderWorkbenchProjectionRepository
  : orderRepository;
```

- [ ] **Step 4: Run the focused test and keep the environment isolated per test.**

Run: `npm test -- --runInBand tests/order/services/orderQuery.service.test.js`

### Task 2: Rebuild and verify existing projections

**Files:**
- Use: `src/modules/order/scripts/backfillOrderWorkbenchProjections.js`

**Interfaces:**
- Consumes: legacy `listOrderWorkbench` rows.
- Produces: one up-to-date projection per order.

- [ ] **Step 1: Verify source and projection tab counts before writing.**

```js
const [sourceCounts, projectionCounts] = await Promise.all([
  source.countByTabs({}), projection.countByTabs({}),
]);
```

- [ ] **Step 2: Run the existing idempotent backfill against database `lng_web_be`.**

Run: `node src/modules/order/scripts/backfillOrderWorkbenchProjections.js --apply=true --batch-size=25`

- [ ] **Step 3: Re-run the count comparison and require zero differences before enabling projection reads.**

```js
expect(diffs).toEqual([]);
```

### Task 3: Enable and measure the fast path locally

**Files:**
- Modify: `.env` only if the rebuilt projection matches source counts.

**Interfaces:**
- Consumes: `ORDER_WORKBENCH_PROJECTION_READ=true`.
- Produces: unchanged order-summary response from the projection repository.

- [ ] **Step 1: Set the existing feature flag.**

```env
ORDER_WORKBENCH_PROJECTION_READ=true
```

- [ ] **Step 2: Restart the local backend and measure the authenticated endpoint.**

- [ ] **Step 3: Confirm source and endpoint tab counts remain equal.**
