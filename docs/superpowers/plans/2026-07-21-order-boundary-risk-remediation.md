# Order Boundary Risk Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove conflicting Order writers and make Order read projections complete, consistent, and authorization-safe.

**Architecture:** `OrderCase` remains the sole writer of the cached `Order.caseStatus`; customer exceptions remain a derived read model with explicit order-based pagination; full-order projections reuse the existing `listAllByOrder()` repository method. Order-specific shop access is consolidated in one internal helper without moving domain rules into `shared/`.

**Tech Stack:** Node.js, CommonJS, Mongoose, Joi, Jest.

## Global Constraints

- Keep cross-module calls through `public.js` only.
- Read-only Mongoose queries must use `.lean()`.
- Do not add schemas, collections, queues, packages, or a second workflow/exception subsystem.
- Do not commit directly to `develop`.
- Preserve existing DTOs unless a response contract is explicitly changed and its consumer is updated in the same task.

---

### Task 1: Remove the direct `caseStatus` writer after caller verification

**Files:**
- Inspect: `src/modules/order/routes/index.js`, `src/modules/order/controllers/order.controller.js`, `src/modules/order/services/orderOperations.service.js`, `src/modules/order/validators/order.validator.js`
- Modify: `src/test/order/routes/index.test.js`, `src/test/order/services/orderOperations.service.test.js`
- Inspect consumer repo: `C:/lng_system/lng-web-fe/src`

**Consumes:** Existing `OrderCase` create/resolve/cancel APIs and `orderCase.service.syncOrderCaseStatus()`.

**Produces:** One source of truth for `Order.caseStatus`; no API path can set `OPEN/NONE` without changing an `OrderCase`.

- [ ] **Step 1: Verify application callers before breaking the route**

Run:

```powershell
rg -n "case-status|updateCaseStatus" src C:\lng_system\lng-web-fe\src
```

Expected: no frontend caller requires the direct route. If a caller exists, update that caller to use `/api/orders/cases` create/resolve/cancel before removing the backend route, then rerun this search.

- [ ] **Step 2: Write the failing route/service tests**

Add a route assertion that `PATCH /api/orders/:orderId/case-status` is not registered after removal, and change the service test from invoking `updateCaseStatus()` to asserting that Case CRUD is responsible for the cache. Keep the existing Case tests that assert:

```js
expect(orderRepository.updateCaseStatus).toHaveBeenCalledWith(orderId, 'OPEN');
```

Run:

```powershell
npm test -- src/test/order/routes/index.test.js src/test/order/services/orderOperations.service.test.js --runInBand
```

Expected: the new route assertion fails while the direct route and writer still exist.

- [ ] **Step 3: Remove the duplicate writer**

Delete the route, controller handler, validator schema, and service method. Keep `orderRepository.updateCaseStatus()` private to `orderCase.service.js` synchronization. Do not remove the repository method or the Case CRUD endpoints.

- [ ] **Step 4: Verify the single-writer contract**

Run:

```powershell
npm test -- src/test/order/routes/index.test.js src/test/order/services/orderCase.service.test.js src/test/order/services/orderOperations.service.test.js --runInBand
```

Expected: all selected tests pass and only Case creation/resolution/cancellation updates `Order.caseStatus`.

### Task 2: Make customer-exceptions pagination honest

**Files:**
- Modify: `src/modules/order/services/customerException.service.js`
- Test: `src/test/order/services/customerException.service.test.js`
- Inspect/update consumer: `C:/lng_system/lng-web-fe/src`

**Consumes:** `orderQueryService.listOrderWorkbench()` response `{ items, total, page, limit }`.

**Produces:** An explicit order-page preview contract. Exception rows are derived from the returned order page; the response no longer claims that `total` is the global exception-row count.

- [ ] **Step 1: Add a failing contract test for multiple exceptions per order**

Use a workbench response with two exception rows from one order and `total: 41, page: 2, limit: 20`. Assert:

```js
expect(result).toMatchObject({
  items: expect.any(Array),
  paginationUnit: 'ORDERS',
  orderPagination: { total: 41, page: 2, limit: 20 },
});
expect(result).not.toHaveProperty('total');
```

Run:

```powershell
npm test -- src/test/order/services/customerException.service.test.js --runInBand
```

Expected: failure because the current response returns `total: items.length`.

- [ ] **Step 2: Update the response contract**

Return:

```js
return {
  items,
  paginationUnit: 'ORDERS',
  orderPagination: {
    total: workbench.total || 0,
    page: workbench.page || page,
    limit: workbench.limit || limit,
  },
};
```

Do not fetch every workbench page, add an exception collection, or call the result an exception-row total. Update the FE consumer to read `orderPagination` if one exists.

- [ ] **Step 3: Verify the preview contract**

Run:

```powershell
npm test -- src/test/order/services/customerException.service.test.js src/test/order/routes/index.test.js --runInBand
```

Expected: all selected tests pass and the response clearly identifies order-based pagination.

### Task 3: Remove silent 100-item truncation from full-order projections

**Files:**
- Modify: `src/modules/order/services/orderCostCenterStatus.service.js`, `src/modules/order/services/orderQuery.service.js`
- Test: `src/test/order/services/orderCostCenterStatus.service.test.js`, `src/test/order/services/orderQuery.service.test.js`

**Consumes:** Existing `orderItemRepository.listAllByOrder(orderId)` and existing enrichment public ports.

**Produces:** Cost/PSD cache refresh and `GET /api/orders/:orderId/expanded` process every item in the order while preserving the response shape.

- [ ] **Step 1: Add failing item-101 tests**

For cost-center status, mock 101 items where the first 100 have plans and item 101 has no plan; assert `MISSING`. For expanded order, mock 101 items through `listAllByOrder()` and assert the returned `items` length is 101.

Run:

```powershell
npm test -- src/test/order/services/orderCostCenterStatus.service.test.js src/test/order/services/orderQuery.service.test.js --runInBand
```

Expected: the new tests fail because production currently calls `listByOrder(... limit: 100)`.

- [ ] **Step 2: Reuse the existing all-items query**

Replace the full-order reads with:

```js
const items = await orderItemRepository.listAllByOrder(orderId);
```

Use `items` for mapping, listing, customization, production, and shipment enrichment IDs. Do not add another repository method or increase a pagination constant.

- [ ] **Step 3: Verify complete projection behavior**

Run:

```powershell
npm test -- src/test/order/services/orderCostCenterStatus.service.test.js src/test/order/services/orderQuery.service.test.js --runInBand
```

Expected: item 101 affects aggregate status and expanded order returns all 101 items.

### Task 4: Align readiness and workbench status semantics

**Files:**
- Modify: `src/modules/order/services/orderReadiness.service.js`, `src/modules/order/dtos/order.dto.js`
- Test: `src/test/order/services/orderReadiness.service.test.js`, `src/test/order/dtos/order.dto.test.js`

**Consumes:** `addressValidationStatuses.VALID`, `addressValidationStatuses.OVERRIDDEN`, and canonical `order.costCenterStatus`.

**Produces:** Workflow/readiness agree that `OVERRIDDEN` is address-ready, and workbench exposes the same cost-center meaning as the Order cache.

- [ ] **Step 1: Add failing semantic tests**

Use the existing readiness fixture with `order.addressValidationStatus = 'OVERRIDDEN'` and assert:

```js
expect(result.checks.address).toEqual({ ok: true, status: 'OVERRIDDEN' });
```

Use this workbench DTO fixture:

```js
const result = toOrderWorkbenchDto({
  items: [{
    order: { _id: 'order-1', costCenterStatus: 'MISSING' },
    items: [{ item: { _id: 'item-1', price: { currency: 'USD' } }, fulfillmentPlan: { costEstimate: { totalAmount: 500 } } }],
  }],
});
expect(result.items[0].order.pricing.costCenterStatus).toBe('MISSING');
```

Run:

```powershell
npm test -- src/test/order/services/orderReadiness.service.test.js src/test/order/dtos/order.dto.test.js --runInBand
```

Expected: both assertions fail before the semantic fix.

- [ ] **Step 2: Implement canonical facts**

Use one readiness set:

```js
const READY_ADDRESS_STATUSES = new Set([
  addressValidationStatuses.VALID,
  addressValidationStatuses.OVERRIDDEN,
]);
const address = {
  ok: READY_ADDRESS_STATUSES.has(order.addressValidationStatus),
  status: order.addressValidationStatus,
};
```

Set workbench `pricing.costCenterStatus` from `order.costCenterStatus || 'MISSING'`. Keep `totalCostAmount` as estimate data and do not rename it to cost-center status.

- [ ] **Step 3: Verify semantic alignment**

Run:

```powershell
npm test -- src/test/order/services/orderReadiness.service.test.js src/test/order/dtos/order.dto.test.js src/test/order/services/orderWorkflow.service.test.js --runInBand
```

Expected: readiness, workflow, and workbench use compatible status meanings.

### Task 5: Consolidate Order-private shop RBAC helpers

**Files:**
- Create: `src/modules/order/services/orderAccess.service.js`
- Modify: `src/modules/order/services/orderCase.service.js`, `orderQuery.service.js`, `orderReadiness.service.js`, `orderAddressValidation.service.js`, `orderAssignment.service.js`, `orderItemCancel.service.js`, `orderItemRecheck.service.js`, `orderOperations.service.js`, `orderReplacement.service.js`
- Test: `src/test/order/services/orderAccess.service.test.js` and affected service tests

**Consumes:** `authPublic.canAccessScope()` and existing `ORDERS:READ/WRITE` constants.

**Produces:** One Order-internal implementation for global/scoped read and write checks, including readable shop-id filtering.

- [ ] **Step 1: Add failing helper tests**

Test these exact behaviors:

```js
authPublic.canAccessScope.mockImplementation((_auth, permission) => permission === 'ORDERS:WRITE');
expect(access.canReadShop(shopId, { permissions: [], scopes: [] })).toBe(true);
expect(access.canWriteShop(shopId, { permissions: [], scopes: [] })).toBe(true);

authPublic.canAccessScope.mockImplementation((_auth, permission) => permission === 'ORDERS:READ');
expect(access.canWriteShop(shopId, { permissions: [], scopes: [] })).toBe(false);
```

Also test `getReadableShopIds()` returns `null` for global read, the unique scoped shop IDs for READ or WRITE scopes, and `[]` for no access.

- [ ] **Step 2: Run the helper tests and verify red**

Run:

```powershell
npm test -- src/test/order/services/orderAccess.service.test.js --runInBand
```

Expected: failure because the helper file does not exist.

- [ ] **Step 3: Implement the minimal Order-private helper**

Export only:

```js
canReadShop(shopId, authContext);
canWriteShop(shopId, authContext);
assertCanReadShop(shopId, authContext);
assertCanWriteShop(shopId, authContext);
getReadableShopIds(authContext);
```

`ORDERS:WRITE` implies read; read never implies write. Preserve the existing `authContext === null/undefined` system bypass only in call sites that already use it. Migrate callers without changing their public signatures.

- [ ] **Step 4: Verify authorization regression coverage**

Run:

```powershell
npm test -- src/test/order/services/orderAccess.service.test.js src/test/order/services/orderCase.service.test.js src/test/order/services/orderQuery.service.test.js src/test/order/services/orderReadiness.service.test.js src/test/order/services/orderOperations.service.test.js --runInBand
```

Expected: all selected tests pass and write permissions cannot be downgraded or broadened accidentally.

### Task 6: Full verification and contract review

**Files:**
- Verify: all modified Order tests, E2E order tests, architecture contract

- [ ] **Step 1: Run Order and E2E verification**

```powershell
npm test -- src/test/order src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand
```

- [ ] **Step 2: Run architecture verification**

```powershell
npm run test:architecture -- --runInBand
```

- [ ] **Step 3: Run the full suite**

```powershell
npm test -- --runInBand
```

- [ ] **Step 4: Inspect scope and whitespace**

```powershell
git diff --check
git diff -- src/modules/order src/test/order src/test/e2e/orderFulfillmentFlow.e2e.test.js
```

Expected: all tests pass, architecture checks pass, and no unrelated module or `.codegraph/daemon.pid` change is included.
