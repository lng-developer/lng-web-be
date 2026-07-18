# Order P0 Edge-Case Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add executable P0 contracts for recoverable imports, safe production gating, vendor cancellation, webhook ordering, and multi-item delivery completion.

**Architecture:** Reuse the existing Jest service-contract suites for narrow boundary behavior and add only the cross-module assertions that belong in `orderFulfillmentFlow.e2e.test.js`. Production code changes stay limited to the three proven gaps: rejecting cancellation after vendor submission, preventing invalid shipment transitions, and excluding cancelled items from parent-delivery aggregation.

**Tech Stack:** Node.js CommonJS, Jest 30, mocked module public ports, Mongoose repositories.

## Global Constraints

- Cross-module calls use only `public.js` ports.
- Do not add dependencies, queues, schemas, or database transactions.
- Preserve unrelated dirty worktree changes.
- Keep each test deterministic; use repository/public-port mocks rather than network or database access.
- Run changed test files with `--runInBand`, then run the E2E contract and architecture test.

## File Structure

- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js` -- repair its `order/public` mock and add cross-module address/cancellation coverage.
- Modify: `src/test/order/orderImport.service.test.js` -- add partial-failure retry and re-import preservation contracts.
- Modify: `src/test/order/services/orderItemCancel.service.test.js` -- define the submitted-vendor cancellation rejection.
- Modify: `src/modules/order/services/orderItemCancel.service.js` -- inspect a vendor submission through `vendorSubmission/public` before cancelling.
- Modify: `src/test/order/services/orderAddressValidation.service.test.js` -- verify non-US validation skips Smarty and synchronizes `NOT_CHECKED`.
- Modify: `src/test/production/services/productionTask.service.test.js` -- verify scale upload rejects `NOT_CHECKED` address status.
- Create: `src/test/shipment/services/shipmentWebhook.service.test.js` -- test delayed-tracking and duplicate delivery webhook behavior.
- Modify: `src/test/shipment/services/shipment.service.test.js` -- add shipment transition and cancelled-sibling aggregation contracts.
- Modify: `src/modules/shipment/services/shipment.service.js` -- enforce the transition rules established by the failing shipment tests.

---

### Task 1: Restore the Existing E2E Harness

**Files:**
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js:14-27`

**Interfaces:**
- Consumes: `orderPublic.addressValidationStatuses` from `src/modules/order/public.js`.
- Produces: A loadable production service in the E2E suite.

- [ ] **Step 1: Add the public constant to the Jest mock.**

```js
jest.mock('../../modules/order/public', () => ({
  // existing mocked functions
  addressValidationStatuses: {
    NOT_CHECKED: 'NOT_CHECKED',
    VALID: 'VALID',
    OVERRIDDEN: 'OVERRIDDEN',
  },
}));
```

- [ ] **Step 2: Run the current E2E contract.**

Run: `npm test -- --runInBand src/test/e2e/orderFulfillmentFlow.e2e.test.js`

Expected: Jest executes assertions instead of failing during module initialization with `Cannot read properties of undefined (reading 'VALID')`.

### Task 2: Add Recoverable Partial Import and Re-import Contracts

**Files:**
- Modify: `src/test/order/orderImport.service.test.js`
- Modify only if required by the failing test: `src/modules/order/services/orderImport.service.js`

**Interfaces:**
- Consumes: `importExternalOrder(dto)` and mocked order/order-item repositories.
- Produces: A documented retry-safe import boundary.

- [ ] **Step 1: Add a two-item DTO fixture and a partial-failure test.**

```js
orderItemRepository.create
  .mockResolvedValueOnce({ _id: 'item-1', orderId: 'order-1', externalItemId: 'line-1' })
  .mockRejectedValueOnce(new Error('second item write failed'));

await expect(orderImportService.importExternalOrder(twoItemDto)).rejects.toThrow('second item write failed');
expect(orderReadinessService.updateCostCenterStatusForOrder).not.toHaveBeenCalled();
expect(orderReadinessService.updatePsdStatusForOrder).not.toHaveBeenCalled();
```

- [ ] **Step 2: Add the retry half of the same scenario.**

```js
orderRepository.findByExternalIdentity.mockResolvedValue(existingOrder);
orderItemRepository.findByExternalIdentity
  .mockResolvedValueOnce(existingFirstItem)
  .mockResolvedValueOnce(null);
orderItemRepository.create.mockResolvedValueOnce(createdSecondItem);

const result = await orderImportService.importExternalOrder(twoItemDto);
expect(result.itemResults).toEqual(expect.arrayContaining([
  expect.objectContaining({ externalItemId: 'line-1', updated: true }),
  expect.objectContaining({ externalItemId: 'line-2', created: true }),
]));
```

- [ ] **Step 3: Add a re-import-after-production test.**

```js
orderItemRepository.findByExternalIdentity.mockResolvedValue({
  _id: 'item-1', orderId: 'order-1', externalItemId: 'line-1', status: 'SENT_TO_VENDOR',
});

await orderImportService.importExternalOrder(oneItemDto);

expect(orderItemRepository.updateFromExternalImport).toHaveBeenCalledWith(
  'item-1',
  expect.objectContaining({ set: expect.not.objectContaining({ status: expect.anything() }) }),
);
expect(orderItemRepository.create).not.toHaveBeenCalled();
```

- [ ] **Step 4: Run the focused import suite.**

Run: `npm test -- --runInBand src/test/order/orderImport.service.test.js`

Expected: partial failure does not recalculate readiness; retry updates the first line and creates only the missing line; re-import never writes `status`.

### Task 3: Lock the Non-US Address Gate

**Files:**
- Modify: `src/test/order/services/orderAddressValidation.service.test.js`
- Modify: `src/test/production/services/productionTask.service.test.js`
- Modify only if required by the failing test: `src/modules/order/services/orderAddressValidation.service.js` or `src/modules/production/services/productionTask.service.js`

**Interfaces:**
- Consumes: `validateAddress(orderId)` and `uploadScaledFile(taskId, fileCheckId, assetId, authContext)`.
- Produces: The `NOT_CHECKED` to production-blocked contract for non-US orders.

- [ ] **Step 1: Add the non-US validation test.**

```js
orderRepository.findById.mockResolvedValue({
  _id: orderId,
  shopId,
  shippingAddress: { countryCode: 'CA', addressLine1: '1 Main St' },
  externalData: {},
});

const result = await service.validateAddress(orderId);
expect(smartyClient.validateUsStreetAddress).not.toHaveBeenCalled();
expect(result.addressValidationStatus).toBe('NOT_CHECKED');
expect(productionPublic.syncOrderAddressSnapshot).toHaveBeenCalledWith(
  expect.objectContaining({ addressValidationStatus: 'NOT_CHECKED' }),
);
```

- [ ] **Step 2: Add the scale-rejection test using an order snapshot with `NOT_CHECKED`.**

```js
orderPublic.findById.mockResolvedValue({ _id: orderId, addressValidationStatus: 'NOT_CHECKED' });

await expect(service.uploadScaledFile(taskId, fileCheckId, assetId, authContext))
  .rejects.toMatchObject({
    statusCode: 409,
    code: 'CONFLICT_ERROR',
    details: { addressValidationStatus: 'NOT_CHECKED' },
  });
expect(mediaPublic.assertMediaAssetExists).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run both focused suites.**

Run: `npm test -- --runInBand src/test/order/services/orderAddressValidation.service.test.js src/test/production/services/productionTask.service.test.js`

Expected: non-US orders are never sent to Smarty and cannot be scaled until a separate operator override changes the address status.

### Task 4: Reject Cancellation After Vendor Submission

**Files:**
- Modify: `src/modules/order/services/orderItemCancel.service.js`
- Modify: `src/test/order/services/orderItemCancel.service.test.js`
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`

**Interfaces:**
- Consumes: `vendorSubmissionPublic.getByOrderItemId(orderItemId)`.
- Produces: `cancelOrderItem()` returns `409 CONFLICT_ERROR` for a `SUBMITTED` vendor submission and makes no state change.

- [ ] **Step 1: Write the failing service test.**

```js
vendorSubmissionPublic.getByOrderItemId.mockResolvedValue({
  id: vendorSubmissionId,
  orderItemId,
  status: 'SUBMITTED',
});

await expect(service.cancelOrderItem(orderItemId, { reason: 'Buyer requested cancellation' }, authContext))
  .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
expect(transitionService.transitionItemStatus).not.toHaveBeenCalled();
expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
```

- [ ] **Step 2: Add the vendor public-port dependency and minimal guard.**

```js
const vendorSubmissionPublic = require('../../vendorSubmission/public');

const submission = await vendorSubmissionPublic.getByOrderItemId(orderItemId);
if (submission?.status === 'SUBMITTED') {
  throw new AppError('Submitted vendor order cannot be cancelled', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR, {
    orderItemId,
    vendorSubmissionId: submission.id,
    status: submission.status,
  });
}
```

- [ ] **Step 3: Mirror the invariant in the E2E contract.**

Set the item to `SENT_TO_VENDOR`, return a `SUBMITTED` submission from the mocked vendor public port, call the order cancellation service, then assert no item transition and no timeline write.

- [ ] **Step 4: Run cancellation and E2E suites.**

Run: `npm test -- --runInBand src/test/order/services/orderItemCancel.service.test.js src/test/e2e/orderFulfillmentFlow.e2e.test.js`

Expected: a pre-submission item can still cancel; a submitted vendor order returns `409` without changing local fulfillment state.

### Task 5: Make Webhook Ordering and Replay Safe

**Files:**
- Create: `src/test/shipment/services/shipmentWebhook.service.test.js`
- Modify: `src/test/shipment/services/shipment.service.test.js`
- Modify only if required by the failing tests: `src/modules/shipment/services/shipment.service.js`

**Interfaces:**
- Consumes: `receiveVendorWebhook(provider, req)`, `updateTracking()`, and `updateStatus()`.
- Produces: skipped tracking-less delivery events, idempotent repeated delivered events, and no invalid direct delivery transition.

- [ ] **Step 1: Add a webhook fixture with a valid secret, submitted vendor submission, adapter, shipment service mocks, and webhook-log repository mock.**

```js
process.env.VENDOR_WEBHOOK_SECRET_MERCHIZE = 'test-secret';
const req = {
  headers: { 'x-vendor-webhook-secret': 'test-secret' },
  body: { vendorSubmissionId, tracking_number: null, status: 'delivered' },
};
```

- [ ] **Step 2: Write the delayed-tracking and repeat-delivery tests.**

```js
await expect(webhookService.receiveVendorWebhook('MERCHIZE', req))
  .resolves.toMatchObject({ statusCode: 202, data: { reason: 'TRACKING_NOT_FOUND' } });
expect(shipmentService.createFromVendorSubmission).not.toHaveBeenCalled();

await webhookService.receiveVendorWebhook('MERCHIZE', deliveredTrackingReq);
await webhookService.receiveVendorWebhook('MERCHIZE', deliveredTrackingReq);
expect(shipmentService.createFromVendorSubmission).toHaveBeenCalledTimes(2);
expect(shipmentService.updateStatus).toHaveBeenLastCalledWith(
  shipmentId,
  { status: 'DELIVERED' },
  expect.objectContaining({ system: true }),
);
```

- [ ] **Step 3: Write the direct transition test in `shipment.service.test.js`.**

```js
repository.findById.mockResolvedValue({ ...shipment, status: 'TRACKING_PENDING' });
await expect(service.updateStatus(shipmentId, { status: 'DELIVERED' }, authContext))
  .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
```

Update the existing successful-delivery tests to load `{ ...shipment, status: 'SHIPPED' }`; retain `TRACKING_PENDING` only for this rejection case.

- [ ] **Step 4: Implement only the validated guards.**

```js
if (shipment.status === shipmentStatuses.DELIVERED) {
  if (shipment.carrier === carrier && shipment.trackingNumber === trackingNumber) {
    return toShipmentDto(shipment);
  }
  throw conflict('Delivered shipment tracking cannot be changed', { status: shipment.status });
}

if (status === shipmentStatuses.DELIVERED && shipment.status !== shipmentStatuses.SHIPPED) {
  throw conflict('Shipment must be shipped before it can be delivered', { status: shipment.status });
}
```

Return the existing DTO before the delivery transition check when the requested status is already `DELIVERED`. This keeps an identical webhook replay as a no-op; it must not create another shipment or move it back to `SHIPPED`.

- [ ] **Step 5: Run shipment suites.**

Run: `npm test -- --runInBand src/test/shipment/services/shipmentWebhook.service.test.js src/test/shipment/services/shipment.service.test.js`

Expected: tracking-less delivery is skipped, valid later tracking can deliver, replay leaves one delivered shipment, and direct `TRACKING_PENDING -> DELIVERED` is rejected.

### Task 6: Complete Orders with Cancelled Siblings

**Files:**
- Modify: `src/test/shipment/services/shipment.service.test.js`
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`
- Modify only if required by the failing test: `src/modules/shipment/services/shipment.service.js`

**Interfaces:**
- Consumes: `markOrderDeliveredWhenComplete(shipment, deliveredAt)` through `updateStatus()`.
- Produces: parent-order delivery that ignores cancelled order items but still requires every active item shipment to be delivered.

- [ ] **Step 1: Add the failing cancelled-sibling test.**

```js
orderPublic.listItemsByOrder.mockResolvedValueOnce([
  { _id: orderItemId, status: 'SHIPPED' },
  { _id: cancelledItemId, status: 'CANCELLED' },
]);
repository.listByOrderItemIds.mockResolvedValueOnce([
  { ...shipment, orderItemId, status: 'DELIVERED' },
]);

await service.updateStatus(shipmentId, { status: 'DELIVERED' }, authContext);
expect(orderPublic.markOrderDelivered).toHaveBeenCalledWith(orderId, expect.any(Date), {
  source: 'SHIPMENT',
});
```

- [ ] **Step 2: Filter cancelled items before shipment aggregation.**

```js
const activeItemIds = items
  .filter((item) => item.status !== 'CANCELLED')
  .map((item) => String(item._id || item.id))
  .filter(Boolean);
if (!activeItemIds.length) return;
```

Use `activeItemIds` for both `listByOrderItemIds()` and the all-delivered check.

- [ ] **Step 3: Add the cross-module E2E assertion.**

After the shipped item reaches `DELIVERED`, set the sibling item to `CANCELLED` and assert the parent receives `markOrderDelivered()` exactly once.

- [ ] **Step 4: Run focused and shared verification.**

Run: `npm test -- --runInBand src/test/shipment/services/shipment.service.test.js src/test/e2e/orderFulfillmentFlow.e2e.test.js`

Expected: a cancelled sibling no longer leaves an otherwise completed order in an undelivered state; a non-cancelled undelivered sibling still blocks completion.

### Task 7: Verify the Complete P0 Slice

**Files:**
- Verify only.

- [ ] **Step 1: Syntax-check every changed production file.**

Run: `node -c src/modules/order/services/orderItemCancel.service.js`

Run: `node -c src/modules/shipment/services/shipment.service.js`

Expected: exit code `0`.

- [ ] **Step 2: Run all affected focused suites.**

Run: `npm test -- --runInBand src/test/order/orderImport.service.test.js src/test/order/services/orderItemCancel.service.test.js src/test/order/services/orderAddressValidation.service.test.js src/test/production/services/productionTask.service.test.js src/test/shipment/services/shipmentWebhook.service.test.js src/test/shipment/services/shipment.service.test.js src/test/e2e/orderFulfillmentFlow.e2e.test.js`

Expected: all named suites pass.

- [ ] **Step 3: Run architectural verification.**

Run: `npm run test:architecture -- --runInBand`

Expected: all architecture assertions pass; no internal cross-module import is introduced.

- [ ] **Step 4: Inspect the scoped diff before any commit.**

Run: `git diff -- src/modules/order/services/orderItemCancel.service.js src/modules/shipment/services/shipment.service.js src/test/order/orderImport.service.test.js src/test/order/services/orderItemCancel.service.test.js src/test/order/services/orderAddressValidation.service.test.js src/test/production/services/productionTask.service.test.js src/test/shipment/services/shipment.service.test.js src/test/shipment/services/shipmentWebhook.service.test.js src/test/e2e/orderFulfillmentFlow.e2e.test.js`

Expected: only the six P0 contracts, their minimal guards, and the E2E mock repair are present.
