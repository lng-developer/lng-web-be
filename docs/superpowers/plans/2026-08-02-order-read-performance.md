# Order Read Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Order workbench, customer-exception, and readiness latency while preserving every existing API contract.

**Architecture:** Keep the existing modular-monolith public ports and DTOs. Replace duplicated workbench reads with one Mongo facet, give customer exceptions a slim enrichment path, and run independent readiness checks concurrently without reloading OrderItem through Mapping.

**Tech Stack:** Node.js, Express, CommonJS, Mongoose/MongoDB aggregation, Jest, k6

## Global Constraints

- Preserve every existing Order route and response field.
- Preserve customer-exception pagination by Order.
- Preserve scoped RBAC and modular-monolith public-port boundaries.
- Do not add a cache, dependency, worker, or materialized read model.
- Do not load-test mutation endpoints against local business data.
- Do not commit unless the user explicitly requests it.

---

### Task 1: One-query workbench page and total

**Files:**
- Modify: `src/modules/order/repositories/order.repository.js`
- Test: `src/test/order/repositories/order.repository.test.js`

**Interfaces:**
- Consumes: existing `listPipeline({ filter, sort, page, limit, search, employeeCode, itemStatus, includeItems, projectItems })` semantics.
- Produces: `listWorkbench(query)` with the unchanged `{ items, total, page, limit }` result from one `Order.aggregate()` call.

- [ ] **Step 1: Write a failing repository test**

Add a test whose mocked aggregate returns:

```js
[{ items: [{ _id: 'order-1', items: [] }], total: [{ count: 7 }] }]
```

Assert `listWorkbench({ page: 2, limit: 3 })` returns `{ items, total: 7, page: 2, limit: 3 }`, invokes `Order.aggregate` once, and the pipeline contains one `$facet` with `items` and `total` branches.

- [ ] **Step 2: Verify RED**

Run: `npx jest src/test/order/repositories/order.repository.test.js --runInBand`

Expected: the new assertion fails because `listWorkbench` currently performs separate page and count operations.

- [ ] **Step 3: Implement the minimum facet**

Build a dedicated workbench pipeline with the existing filter, joined filter, sort, item projection, skip, and limit. Its final shape is:

```js
[
  { $facet: {
    items: workbenchItemStages,
    total: [...matchingStages, { $count: 'count' }],
  } },
]
```

Normalize an empty total facet to zero. Do not change the general `list()` behavior or add a generic aggregation helper.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node -c src/modules/order/repositories/order.repository.js
npx jest src/test/order/repositories/order.repository.test.js --runInBand
```

Expected: syntax succeeds and the repository suite passes.

---

### Task 2: Slim customer-exception candidate path

**Files:**
- Modify: `src/modules/order/services/orderQuery.service.js`
- Modify: `src/modules/order/services/customerException.service.js`
- Test: `src/test/order/services/orderQuery.service.test.js`
- Test: `src/test/order/services/customerException.service.test.js`

**Interfaces:**
- Produces: `orderQueryService.listCustomerExceptionCandidates(query, authContext)` returning `{ items, total, page, limit }`.
- Candidate item shape: `{ order, items: [{ item, customization, tracking }] }`.
- `customerException.service.listCustomerExceptions()` keeps its existing public response.

- [ ] **Step 1: Write failing narrow-path tests**

In the query-service test, mock one order with one item and assert the candidate method calls only:

```js
listWorkbenchOrders(query, authContext)
listItemCustomizations(orderItemIds, authContext)
listItemShipmentSummaries(orderItemIds)
```

Assert HR, production, Mapping, catalog, case, and shop public ports are untouched. In the customer-exception test, mock `listCustomerExceptionCandidates` and assert the current `items`, `paginationUnit`, and `orderPagination` response remains byte-for-byte equivalent to the existing fixture.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx jest src/test/order/services/orderQuery.service.test.js src/test/order/services/customerException.service.test.js --runInBand
```

Expected: the new method is absent and customer exceptions still call `listOrderWorkbench`.

- [ ] **Step 3: Implement the narrow path**

Add `listCustomerExceptionCandidates` beside `listOrderWorkbench`. Reuse `listWorkbenchOrders`, group items by order, and run only customization and shipment batch calls in `Promise.all`. Export the function and switch `customerException.service` to it.

Do not extract a new class or add an `include` option to workbench.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node -c src/modules/order/services/orderQuery.service.js
node -c src/modules/order/services/customerException.service.js
npx jest src/test/order/services/orderQuery.service.test.js src/test/order/services/customerException.service.test.js --runInBand
```

Expected: both service suites pass and the customer-exception contract is unchanged.

---

### Task 3: Concurrent readiness checks without duplicate Mapping lookup

**Files:**
- Modify: `src/modules/order/services/orderReadiness.service.js`
- Test: `src/test/order/services/orderReadiness.service.test.js`

**Interfaces:**
- Consumes: `mapping.public.listFulfillmentPlansByOrderItemIds(orderItemIds, authContext)`.
- Produces: the unchanged readiness object with `address`, `customization`, `mapping`, `blockingIssues`, and `itemStatus` checks.

- [ ] **Step 1: Write failing behavior tests**

Replace the single-plan Mapping mock with `listFulfillmentPlansByOrderItemIds`. Assert it receives:

```js
[[orderItemId], { system: true, source: 'ORDER_READINESS' }]
```

Add deferred promises for customization, Mapping, and integration issues. Call `getOrderItemReadiness`, then assert all three dependencies have been invoked before resolving any deferred promise. This test fails if one check is awaited before the others start.

- [ ] **Step 2: Verify RED**

Run: `npx jest src/test/order/services/orderReadiness.service.test.js --runInBand`

Expected: Mapping still calls `getFulfillmentPlanForOrderItem`, and customization prevents the other checks from starting.

- [ ] **Step 3: Implement parallel checks**

Change `getMappingCheck` to read the first result from the Mapping batch port. In `getOrderItemReadiness`, use:

```js
const [customization, mapping, { issues, check: blockingIssues }] = await Promise.all([
  getCustomizationCheck(item),
  getMappingCheck(item),
  getBlockingIssuesCheck(item),
]);
```

Keep existing error propagation and missing-plan behavior.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node -c src/modules/order/services/orderReadiness.service.js
npx jest src/test/order/services/orderReadiness.service.test.js --runInBand
```

Expected: the readiness suite passes.

---

### Task 4: Regression and performance acceptance

**Files:**
- No production file changes unless verification exposes a regression.
- Use: `test/load/expected-load.js`

**Interfaces:**
- Verifies the three optimized read paths and reports expanded-order behavior without speculative edits.

- [ ] **Step 1: Run focused and architecture verification**

Run:

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
node -r dotenv/config ./node_modules/jest/bin/jest.js src/test/order --runInBand
node -r dotenv/config ./node_modules/jest/bin/jest.js src/test/architecture.contract.test.js --runInBand
```

Expected: all Order and architecture suites pass.

- [ ] **Step 2: Run the full suite**

Run:

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
node -r dotenv/config ./node_modules/jest/bin/jest.js --runInBand
```

Expected: zero failed suites. Report skipped suites separately.

- [ ] **Step 3: Restart the local backend and benchmark safe GET endpoints**

Benchmark these routes at 1/5/10/20 VU using the existing local benchmark account and an in-memory 15-minute token:

```text
/api/orders/workbench?limit=20
/api/orders/customer-exceptions?limit=20
/api/orders/items/:orderItemId/readiness
/api/orders/:orderId/expanded
```

Use 1s ramp-up, 3s steady, and 1s ramp-down. Do not store or print the token.

- [ ] **Step 4: Apply the acceptance gate**

Success requires 0% errors and 20-VU p95 below 2s for workbench, below 1s for customer exceptions, and below 500ms for readiness. Report expanded-order p95; do not modify it unless it remains above 1s.

