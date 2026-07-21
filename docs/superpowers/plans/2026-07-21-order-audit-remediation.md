# Order Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct order-case read authorization, customization readiness error handling, and finance item linking.

**Architecture:** Keep the external API unchanged. Read authorization is normalized inside the case service, readiness preserves non-domain errors from the customization public port, and repository lookup uses strong identity followed by a uniquely resolvable SKU fallback.

**Tech Stack:** Node.js, CommonJS, Mongoose, Jest.

## Global Constraints

- Keep cross-module calls through `public.js` only.
- Keep read-only Mongoose queries on `.lean()`.
- Do not add routes, schemas, packages, or migrations.
- Do not commit directly to `develop`.

---

### Task 0: Restore the E2E shipment repository mock

**Files:**
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`

**Produces:** The E2E mocks support the atomic shipment updates and idempotent timeline write used by the shipment flow.

- [ ] **Step 1: Verify the existing failure**

Run: `npm test -- src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

Expected: it fails because `updateTrackingIfNotDelivered` is missing from the mock.

- [ ] **Step 2: Add the contract-faithful mock**

```js
updateTrackingIfNotDelivered: jest.fn(),
updateStatusIfCurrent: jest.fn(),
appendTimelineOnce: jest.fn(),

shipmentRepository.updateTrackingIfNotDelivered.mockImplementation(async (_shipmentId, patch) => {
  if (!['TRACKING_PENDING', 'SHIPPED'].includes(shipment?.status)) return null;
  shipment = { ...shipment, ...patch, updatedAt: new Date() };
  return shipment;
});

shipmentRepository.updateStatusIfCurrent.mockImplementation(async (_shipmentId, status, patch) => {
  if (shipment?.status !== status) return null;
  shipment = { ...shipment, ...patch, updatedAt: new Date() };
  return shipment;
});

orderPublic.appendTimelineOnce.mockResolvedValue({});
```

- [ ] **Step 3: Run the focused E2E test**

Run: `npm test -- src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

Expected: all tests pass.

### Task 1: Allow write grants to read order cases

**Files:**
- Modify: `src/modules/order/services/orderCase.service.js`
- Test: `src/test/order/services/orderCase.service.test.js`

**Consumes:** Existing `authContext.permissions`, `authContext.scopes`, and `authPublic.canAccessScope()`.

**Produces:** `listOrderCases()` and `getOrderCase()` accept global or scoped `ORDERS:WRITE` access; mutating case operations remain `ORDERS:WRITE` only.

- [ ] **Step 1: Write the failing tests**

```js
test('lists cases for a user with scoped write permission', async () => {
  repository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  await service.listOrderCases({}, {
    permissions: [],
    scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }],
  });
  expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ shopIds: [shopId] }));
});

test('reads a case for a user with scoped write permission', async () => {
  authPublic.canAccessScope.mockImplementation((_context, permission) => permission === 'ORDERS:WRITE');
  await expect(service.getOrderCase(caseId, { permissions: [], scopes: [] }))
    .resolves.toEqual(expect.objectContaining({ id: caseId }));
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/test/order/services/orderCase.service.test.js --runInBand`

Expected: the scoped-write list test returns an empty result and the scoped-write detail test rejects with `403`.

- [ ] **Step 3: Implement the minimal read permission fallback**

```js
function hasGlobal(authContext = {}, permission) {
  const permissions = authContext.permissions || [];
  return permissions.includes(permission)
    || (permission === ORDER_READ_PERMISSION && permissions.includes(ORDER_WRITE_PERMISSION));
}

function canAccessShop(shopId, permission, authContext) {
  return authPublic.canAccessScope(authContext, permission, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId })
    || (permission === ORDER_READ_PERMISSION && authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId }));
}
```

Use the same read fallback when building scoped shop IDs and asserting case access. Keep write assertions unchanged.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- src/test/order/services/orderCase.service.test.js --runInBand`

Expected: all tests pass.

### Task 2: Preserve unexpected customization readiness errors

**Files:**
- Modify: `src/modules/order/services/orderReadiness.service.js`
- Test: `src/test/order/services/orderReadiness.service.test.js`

**Consumes:** `customization.public.assertCustomizationReady()` which throws `AppError` with `statusCode: 409` and `code: 'CONFLICT_ERROR'` when its payload is not parsed.

**Produces:** A customization conflict remains a readiness blocker. Missing payloads and unexpected errors are not converted to `CUSTOMIZATION_NOT_READY`.

- [ ] **Step 1: Write the failing tests**

```js
test('returns not ready when customization reports a conflict', async () => {
  customizationPublic.assertCustomizationReady.mockRejectedValue({ statusCode: 409, code: 'CONFLICT_ERROR' });
  await expect(service.getOrderItemReadiness(orderItemId)).resolves.toMatchObject({
    ready: false,
    blockingReasons: ['CUSTOMIZATION_NOT_READY'],
  });
});

test('propagates a customization payload error', async () => {
  const error = Object.assign(new Error('Customization payload not found'), { statusCode: 404, code: 'RESOURCE_NOT_FOUND' });
  customizationPublic.assertCustomizationReady.mockRejectedValue(error);
  await expect(service.getOrderItemReadiness(orderItemId)).rejects.toBe(error);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/test/order/services/orderReadiness.service.test.js --runInBand`

Expected: the missing-payload test resolves with an incorrect `CUSTOMIZATION_NOT_READY` result.

- [ ] **Step 3: Implement the conflict-only mapping**

```js
  } catch (error) {
    if (error.statusCode !== httpStatus.CONFLICT || error.code !== errorCodes.CONFLICT_ERROR) {
      throw error;
    }
    return { ok: false, status: 'NOT_READY' };
  }
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- src/test/order/services/orderReadiness.service.test.js --runInBand`

Expected: all tests pass.

### Task 3: Link finance rows only with a unique fallback

**Files:**
- Modify: `src/modules/order/repositories/orderItem.repository.js`
- Create: `src/test/order/repositories/orderItem.repository.test.js`

**Consumes:** `{ shopId, salesChannelCode, marketplaceCode, externalOrderId, externalItemId, sku }` from `order.public.findItemByFinanceIdentity()`.

**Produces:** Exact external-item matches win. An unmatched external item may fall back to SKU only when one order item matches; ambiguous or missing candidates return `null`.

- [ ] **Step 1: Write the failing repository tests**

```js
test('falls back to a unique SKU match when external item code differs', async () => {
  OrderItem.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValueOnce(null) });
  OrderItem.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: itemId }]) }) });
  await expect(repository.findByFinanceIdentity(identity)).resolves.toEqual({ _id: itemId });
});

test('does not link an ambiguous SKU match', async () => {
  OrderItem.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValueOnce(null) });
  OrderItem.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: itemId }, { _id: secondItemId }]) }) });
  await expect(repository.findByFinanceIdentity(identity)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/test/order/repositories/orderItem.repository.test.js --runInBand`

Expected: both tests fail because the repository only issues one strict `findOne()` query.

- [ ] **Step 3: Implement exact identity then bounded unique-SKU lookup**

```js
const filter = { shopId, salesChannelCode, marketplaceCode, externalOrderId };
if (externalItemId) {
  const exact = await OrderItem.findOne({ ...filter, externalItemId }).lean();
  if (exact) return exact;
}
if (!sku) return null;
const matches = await OrderItem.find({ ...filter, sku }).limit(2).lean();
return matches.length === 1 ? matches[0] : null;
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- src/test/order/repositories/orderItem.repository.test.js --runInBand`

Expected: all tests pass.

### Task 4: Verify the combined behavior

**Files:**
- Verify: `src/test/order/services/orderCase.service.test.js`
- Verify: `src/test/order/services/orderReadiness.service.test.js`
- Verify: `src/test/order/repositories/orderItem.repository.test.js`
- Verify: `src/test/architecture.contract.test.js`

- [ ] **Step 1: Run narrow verification**

Run: `npm test -- src/test/order/services/orderCase.service.test.js src/test/order/services/orderReadiness.service.test.js src/test/order/repositories/orderItem.repository.test.js --runInBand`

Expected: all selected tests pass.

- [ ] **Step 2: Run architecture verification**

Run: `npm run test:architecture -- --runInBand`

Expected: architecture contract passes.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check; git diff -- src/modules/order src/test/order`

Expected: no whitespace errors; changes are limited to the three behavior fixes and their regression tests.
