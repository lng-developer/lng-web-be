# Shipment Tracking Edge Cases V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and close the remaining safety gaps in duplicate, delayed, partial, and cross-shop shipment tracking events.

**Architecture:** Keep `shipment` as the tracking lifecycle owner and route every status mutation through its service methods. `vendorSubmission` remains the shipment-creation gate, and `order.public` remains the sole order-item status boundary. This plan adds focused tests first and changes production code only when a failing test demonstrates a contract violation.

**Tech Stack:** Node.js, Express, Mongoose, Jest, Joi, CommonJS.

## Global Constraints

- Do not add a module, collection, queue, carrier API, or multi-package support.
- Do not call vendor submit APIs or add vendor credential CRUD.
- Cross-module calls use only `order/public.js`, `vendorSubmission/public.js`, and `auth/public.js`.
- Keep webhook request/raw-result sanitization; persist a sanitized raw payload, stripping secret, token, authorization, password, local-path, and raw-credential keys.
- Preserve `Shipment` unique active `vendorSubmissionId` idempotency behavior.
- Use `AppError` with existing error codes and do not leak vendor HTTP payloads.
- Do not modify order-item status directly from `shipment`.

---

## File Structure

- Modify: `src/test/shipment/services/shipment.service.test.js` - lifecycle, recheck, duplicate, multi-item, and scope contracts.
- Modify: `src/test/shipment/services/shipmentWebhook.service.test.js` - webhook replay, partial payload, resolver, and log contracts.
- Modify only if a failing test proves it necessary: `src/modules/shipment/services/shipment.service.js` - centralized lifecycle guard.
- Modify only if a failing test proves it necessary: `src/modules/shipment/services/shipmentWebhook.service.js` - webhook resolution/log behavior.
- Modify only if a failing test proves it necessary: `src/modules/shipment/models/vendorWebhookLog.model.js` - scoped webhook-log evidence.
- Modify only if a failing test proves it necessary: `src/modules/shipment/repositories/vendorWebhookLog.repository.js` - scoped webhook-log queries.
- Modify: `docs/shipment/SHIPMENT_API.md` - exact idempotency and out-of-order behavior.
- Modify: `docs/architecture/SHIPMENT_MODULE.md` - ownership and state guarantees.
- Modify: `docs/bruno/Shipment/*` - manual recheck and webhook replay requests if the collection exists under this path; otherwise use the existing Bruno shipment folder.

## Commit 1: `test(shipment): cover tracking lifecycle edge cases`

### Task 1: Prove service idempotency and state monotonicity

**Files:**
- Modify: `src/test/shipment/services/shipment.service.test.js`

**Interfaces:**
- Consumes: `shipment.service.createFromVendorSubmission(vendorSubmissionId, authContext)`.
- Consumes: `shipment.service.updateTracking(shipmentId, payload, authContext)`.
- Consumes: `shipment.service.updateStatus(shipmentId, payload, authContext)`.
- Produces: executable lifecycle contracts for duplicate creation, complete tracking, and delivered immutability.

- [ ] **Step 1: Add failing tests for duplicate-create races and partial tracking**

```js
test('returns the duplicate shipment after a unique-index create race', async () => {
  repository.create.mockRejectedValueOnce({ code: 11000 });
  repository.findActiveByVendorSubmission.mockResolvedValueOnce(shipment);

  await expect(service.createFromVendorSubmission(vendorSubmissionId, writeAuth))
    .resolves.toMatchObject({ id: shipmentId });
  expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
});

test('does not change a tracking-pending shipment when carrier or tracking is incomplete', async () => {
  await expect(service.updateTracking(shipmentId, { carrier: 'USPS' }, writeAuth))
    .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  expect(repository.updateById).not.toHaveBeenCalled();
  expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test file**

Run: `npx jest src/test/shipment/services/shipment.service.test.js --runInBand`

Expected: Existing behavior passes or exposes a precise lifecycle defect.

- [ ] **Step 3: Add failing tests for out-of-order delivery and tracking correction**

```js
test('does not downgrade a delivered shipment when a delayed shipped event is replayed', async () => {
  repository.findById.mockResolvedValueOnce(deliveredShipment);

  await expect(service.updateTracking(shipmentId, deliveredTrackingPayload, writeAuth))
    .resolves.toMatchObject({ status: 'DELIVERED' });
  expect(repository.updateById).not.toHaveBeenCalled();
});

test('rejects a changed carrier or tracking number after delivery', async () => {
  repository.findById.mockResolvedValueOnce(deliveredShipment);

  await expect(service.updateTracking(shipmentId, changedTrackingPayload, writeAuth))
    .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
});

test('does not append a second timeline event for the same shipped tracking replay', async () => {
  repository.findById.mockResolvedValueOnce({
    ...shipment,
    status: 'SHIPPED',
    carrier: 'USPS',
    trackingNumber: '9400111899223850000001',
  });

  await service.updateTracking(shipmentId, sameTrackingPayload, writeAuth);
  expect(repository.updateById).not.toHaveBeenCalled();
  expect(orderPublic.appendTimeline).not.toHaveBeenCalled();
});

test.each(['EXCEPTION', 'CANCELLED'])('rejects terminal delivery transition to %s', async (status) => {
  repository.findById.mockResolvedValueOnce({ ...shipment, status: 'DELIVERED' });

  await expect(service.updateStatus(shipmentId, { status }, writeAuth))
    .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
});
```

- [ ] **Step 4: Implement only the proven missing guard**

Keep the guard in `updateTracking()` so manual, webhook, and vendor-polling paths share it:

```js
if (shipment.status === shipmentStatuses.DELIVERED) {
  if (shipment.carrier === carrier && shipment.trackingNumber === trackingNumber) {
    return toShipmentDto(shipment);
  }
  throw conflict('Delivered shipment tracking cannot be changed', { status: shipment.status });
}
```

Add the same-value no-op before writing a `SHIPPED` shipment, and reject status actions from terminal states. Do not add a second state machine in a controller or adapter.

- [ ] **Step 5: Re-run the focused test file**

Run: `npx jest src/test/shipment/services/shipment.service.test.js --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/test/shipment/services/shipment.service.test.js src/modules/shipment/services/shipment.service.js
git commit -m "test(shipment): cover tracking lifecycle edge cases"
```

Only stage `shipment.service.js` if Step 4 required a production change.

## Commit 2: `test(shipment): harden webhook replay, resolution, and log scope`

### Task 2: Prove webhook safety under duplicate, partial, and unmatched vendor events

**Files:**
- Modify: `src/test/shipment/services/shipmentWebhook.service.test.js`
- Modify: `src/test/shipment/routes/index.test.js`
- Modify only if tests fail: `src/modules/shipment/services/shipmentWebhook.service.js`
- Modify only if tests fail: `src/modules/shipment/models/vendorWebhookLog.model.js`
- Modify only if tests fail: `src/modules/shipment/repositories/vendorWebhookLog.repository.js`

**Interfaces:**
- Consumes: `receiveVendorWebhook(provider, req)`.
- Consumes: `vendorSubmission.public.getById`, `getByOrderItemId`, and `getByProviderExternalOrderId`.
- Produces: `200` for applied tracking and submission-bound pending rechecks, `202` for safe webhook skips, and a sanitized raw-payload log entry for every webhook outcome.

- [ ] **Step 1: Add failing webhook tests**

```js
test('acknowledges delivered-without-tracking without creating a shipment', async () => {
  const result = await service.receiveVendorWebhook('MERCHIZE', deliveredWithoutTrackingRequest);

  expect(result).toMatchObject({ statusCode: 202, data: { reason: 'TRACKING_NOT_FOUND' } });
  expect(shipmentRepository.create).not.toHaveBeenCalled();
  expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
});

test('resolves a webhook only by normalized provider plus vendor external order id', async () => {
  await service.receiveVendorWebhook('printway', providerOrderIdRequest);

  expect(vendorSubmissionPublic.getByProviderExternalOrderId).toHaveBeenCalledWith({
    provider: 'PRINTWAY',
    vendorExternalOrderId: '4095267035',
  });
});

test('writes a sanitized skipped log for an unmatched vendor event', async () => {
  vendorSubmissionPublic.getByProviderExternalOrderId.mockResolvedValueOnce(null);
  await service.receiveVendorWebhook('printway', unmatchedRequest);

  expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
    outcome: 'SKIPPED',
    message: 'SUBMISSION_NOT_FOUND',
    rawPayload: expect.not.objectContaining({ token: expect.anything() }),
  }));
});

test('stores the resolved submission shop on webhook logs', async () => {
  await service.receiveVendorWebhook('printway', resolvedSubmissionRequest);

  expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
    shopId: submission.shopId,
  }));
});
```

- [ ] **Step 2: Run webhook tests**

Run: `npx jest src/test/shipment/services/shipmentWebhook.service.test.js --runInBand`

Expected: PASS or a focused failure that identifies resolver, sanitization, or lifecycle drift.

- [ ] **Step 3: Implement only the failing behavior through existing service boundaries**

Use the existing resolution order and delegate mutations to the centralized service:

```js
const shipment = await shipmentService.createFromVendorSubmission(submission.id, webhookAuthContext());
const updated = await shipmentService.updateTracking(shipment.id, normalizedTrackingPayload, webhookAuthContext());
return normalized.delivered
  ? shipmentService.updateStatus(updated.id, { status: 'DELIVERED' }, webhookAuthContext())
  : updated;
```

Do not query shipment or vendor-submission models directly from the webhook service.

- [ ] **Step 4: Add scoped webhook-log route/service tests**

```js
test('does not return another shop webhook logs to a scoped reader', async () => {
  await expect(webhookService.listWebhookLogs({}, shopScopedReadAuth))
    .resolves.toMatchObject({ items: [] });
  expect(webhookLogRepository.list).toHaveBeenCalledWith({ shopIds: [shopId] });
});

test('does not expose unresolved legacy logs to a scoped reader', async () => {
  await webhookService.listWebhookLogs({}, shopScopedReadAuth);
  expect(webhookLogRepository.list).toHaveBeenCalledWith(expect.objectContaining({ shopIds: [shopId] }));
});
```

Persist `shopId` in `writeLog()` only when submission resolution succeeded. Add `shopId` to `VendorWebhookLog`, index `{ shopId, createdAt: -1 }`, and pass scoped `shopIds` to the repository. The route accepts `SHIPMENTS:READ` or `SHIPMENTS:WRITE`; scoped readers remain restricted to allowed shop IDs, while global readers may list all logs, including legacy/unmatched rows without a shop.

- [ ] **Step 5: Re-run webhook and route tests**

Run: `npx jest src/test/shipment/services/shipmentWebhook.service.test.js src/test/shipment/routes/index.test.js --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/test/shipment/services/shipmentWebhook.service.test.js src/test/shipment/routes/index.test.js src/modules/shipment/services/shipmentWebhook.service.js src/modules/shipment/models/vendorWebhookLog.model.js src/modules/shipment/repositories/vendorWebhookLog.repository.js
git commit -m "test(shipment): harden webhook replay and log scope"
```

Only stage production files required by the failing tests.

## Commit 3: `test(shipment): verify multi-item delivery and batch isolation`

### Task 3: Protect parent-order delivery and batch recheck isolation

**Files:**
- Modify: `src/test/shipment/services/shipment.service.test.js`

**Interfaces:**
- Consumes: `updateStatus(shipmentId, { status: 'DELIVERED' }, authContext)`.
- Consumes: `recheckSubmittedVendorTracking({ provider, shopId, limit }, authContext)`.
- Produces: correct parent-order delivered behavior and bounded per-item batch result.

- [ ] **Step 1: Add focused multi-item delivery tests**

```js
test('does not mark an order delivered while a non-cancelled sibling shipment is pending', async () => {
  orderPublic.listItemsByOrder.mockResolvedValueOnce([firstItem, secondItem]);
  repository.listByOrderItemIds.mockResolvedValueOnce([
    { ...shipment, orderItemId: firstItem._id, status: 'DELIVERED' },
    { ...shipment, orderItemId: secondItem._id, status: 'TRACKING_PENDING' },
  ]);

  await service.updateStatus(shipmentId, { status: 'DELIVERED' }, writeAuth);
  expect(orderPublic.markOrderDelivered).not.toHaveBeenCalled();
});

test('ignores cancelled sibling items when checking parent-order delivery', async () => {
  orderPublic.listItemsByOrder.mockResolvedValueOnce([firstItem, { ...secondItem, status: 'CANCELLED' }]);
  repository.listByOrderItemIds.mockResolvedValueOnce([{ ...shipment, status: 'DELIVERED' }]);

  await service.updateStatus(shipmentId, { status: 'DELIVERED' }, writeAuth);
  expect(orderPublic.markOrderDelivered).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Add batch isolation and scope tests**

```js
test('keeps processing remaining submissions after one vendor adapter failure', async () => {
  vendorSubmissionPublic.listSubmittedForTracking.mockResolvedValue([failingSubmission, validSubmission]);

  const result = await service.recheckSubmittedVendorTracking({ limit: 2 }, writeAuth);
  expect(result).toMatchObject({ checked: 2, failed: 1, applied: 1 });
});

test('only queries submitted submissions inside the write scope', async () => {
  await service.recheckSubmittedVendorTracking({}, shopScopedWriteAuth);
  expect(vendorSubmissionPublic.listSubmittedForTracking).toHaveBeenCalledWith(
    expect.objectContaining({ shopIds: [shopId] }),
    expect.objectContaining({ system: true }),
  );
});
```

- [ ] **Step 3: Run the shipment service suite**

Run: `npx jest src/test/shipment/services/shipment.service.test.js --runInBand`

Expected: PASS or a focused failure in `markOrderDeliveredWhenComplete()` or batch isolation.

- [ ] **Step 4: Implement only the demonstrated gap**

Preserve this parent-order predicate:

```js
const activeItemIds = items
  .filter((item) => item.status !== 'CANCELLED')
  .map((item) => String(item._id || item.id))
  .filter(Boolean);

const allDelivered = activeItemIds.every((orderItemId) => (
  shipmentByItemId.get(orderItemId)?.status === shipmentStatuses.DELIVERED
));
```

Keep failures isolated per batch row; do not fail the full batch for one vendor outage.

- [ ] **Step 5: Re-run the shipment service suite**

Run: `npx jest src/test/shipment/services/shipment.service.test.js --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/test/shipment/services/shipment.service.test.js src/modules/shipment/services/shipment.service.js
git commit -m "test(shipment): verify multi-item delivery and batch isolation"
```

Only stage `shipment.service.js` if Step 4 required a production change.

## Commit 4: `docs(shipment): document tracking safety guarantees`

### Task 4: Make the operational contract testable by API users

**Files:**
- Modify: `docs/shipment/SHIPMENT_API.md`
- Modify: `docs/architecture/SHIPMENT_MODULE.md`
- Modify: existing `docs/bruno/Shipment/*` request files when present

**Interfaces:**
- Consumes: shipment HTTP routes and existing Bruno environment variables.
- Produces: explicit operator behavior for replay, no-tracking, failed/unmatched, delivered, and batch recheck outcomes.

- [ ] **Step 1: Document exact lifecycle invariants**

Add this behavior table to `docs/shipment/SHIPMENT_API.md`:

```markdown
| Input | Result |
| --- | --- |
| Same tracking replay after `DELIVERED` | `200`, no data mutation |
| Changed tracking after `DELIVERED` | `409 CONFLICT_ERROR` |
| Webhook with no usable tracking number | `202 TRACKING_NOT_FOUND`, no shipment or item-status mutation |
| Read-only recheck without `vendorSubmissionId` and no usable tracking | `200`, normalized result only, no DB mutation |
| Submission-bound recheck with no usable tracking | `200`, `TRACKING_PENDING` may be created/reused; no `SHIPPED` or tracking-timeline mutation |
| Webhook cannot resolve a submission | `202 SUBMISSION_NOT_FOUND`, sanitized `SKIPPED` log |
| Batch recheck vendor failure | one `FAILED` row; remaining rows continue |
```

- [ ] **Step 2: Add Bruno replay requests without credentials**

Create or extend the existing Shipment folder with requests that use variables only:

```text
POST {{baseUrl}}/api/shipments/vendor-tracking/recheck
Authorization: Bearer {{accessToken}}

{
  "provider": "PRINTWAY",
  "externalOrderId": "{{vendorExternalOrderId}}"
}
```

Include a second request with `vendorSubmissionId`, and a webhook request with `x-vendor-webhook-secret: {{vendorWebhookSecret}}`. Do not place real tokens or tracking numbers in Bruno files.

- [ ] **Step 3: Run documentation and regression verification**

Run:

```powershell
npx jest src/test/shipment --runInBand
npx jest src/test/order --runInBand
npx jest src/test/vendorSubmission --runInBand
npm run test:architecture -- --runInBand
Get-ChildItem -Path src\modules\shipment -Recurse -Filter *.js | ForEach-Object { node -c $_.FullName }
```

Expected: all selected suites pass and every shipment module JavaScript file has valid syntax.

- [ ] **Step 4: Commit**

```powershell
git add docs/shipment/SHIPMENT_API.md docs/architecture/SHIPMENT_MODULE.md docs/bruno/Shipment
git commit -m "docs(shipment): document tracking safety guarantees"
```

Stage only existing/changed Bruno paths; do not add environment secrets.

## Final Review Checklist

- [ ] Duplicate create, duplicate webhook, delayed tracking, and delayed delivery all preserve one shipment.
- [ ] No tracking number means no shipment-state or order-item-state mutation.
- [ ] `DELIVERED` cannot be downgraded and cannot receive a changed tracking number.
- [ ] Parent delivery requires delivered shipments for all non-cancelled items.
- [ ] Batch recheck is bounded to 100 and isolates vendor errors per result row.
- [ ] All cross-module calls remain public-port calls and architecture tests pass.
- [ ] Docs and Bruno use variables only; no token, password, or secret is committed.

## Commit 5: `fix(shipment): secure tracking ingestion retries`

**Implementation status:** complete in `6f0b1c3`, `4fc9e66`, and `0d184b0`.

### Task 5: Resolve final-review security and retry findings

**Files:**
- Modify: `src/modules/shipment/services/shipmentWebhook.service.js`
- Modify: `src/modules/shipment/services/shipment.service.js`
- Modify: `src/modules/shipment/repositories/shipment.repository.js`
- Modify: `src/modules/order/models/orderTimeline.model.js`
- Modify: `src/modules/order/repositories/orderTimeline.repository.js`
- Modify: `src/modules/order/services/orderTimeline.service.js`
- Modify: `src/modules/order/public.js`
- Test: `src/test/shipment/services/shipmentWebhook.service.test.js`
- Test: `src/test/shipment/services/shipment.service.test.js`
- Test: `src/test/shipment/repositories/shipment.repository.test.js`
- Test: `src/test/order/services/orderTimeline.service.test.js`

**Interfaces:**
- Produces: `order.public.appendTimelineOnce(payload)` for idempotent external lifecycle evidence.
- Produces: `shipment.repository.updateTrackingIfNotDelivered(shipmentId, patch)` that never writes a delivered shipment.

- [x] **Step 1: Write failing security and race tests**

```js
test('stores webhook request paths without query tokens', async () => {
  await service.receiveVendorWebhook('printway', requestWithQueryToken);
  expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
    request: expect.objectContaining({ path: '/vendor-webhooks/printway' }),
  }));
});

test('rejects a scoped tracking probe without a submission before vendor fetch', async () => {
  await expect(service.recheckVendorTracking(probePayload, scopedWriteAuth))
    .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  expect(adapter.fetchTrackingByExternalOrderId).not.toHaveBeenCalled();
});

test('does not overwrite a delivered shipment when conditional tracking update loses a race', async () => {
  repository.updateTrackingIfNotDelivered.mockResolvedValueOnce(null);
  repository.findById.mockResolvedValueOnce(deliveredShipment);
  await expect(service.updateTracking(shipmentId, changedTrackingPayload, writeAuth))
    .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
});
```

- [x] **Step 2: Run focused tests to confirm RED**

Run:

```powershell
npx jest src/test/shipment/services/shipmentWebhook.service.test.js src/test/shipment/services/shipment.service.test.js src/test/shipment/repositories/shipment.repository.test.js --runInBand
```

Expected: failures show the existing query-bearing request path, missing pre-fetch scope guard, and unconditional shipment update.

- [x] **Step 3: Implement the smallest shared fixes**

```js
function webhookRequestMeta(req) {
  const rawPath = req.originalUrl || req.url || '';
  return { path: String(rawPath).split('?')[0] /* remaining metadata */ };
}

async function updateTrackingIfNotDelivered(shipmentId, patch) {
  return Shipment.findOneAndUpdate(
    { _id: shipmentId, status: { $ne: shipmentStatuses.DELIVERED } },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}
```

Before any vendor fetch, a request with `vendorSubmissionId` must load that submission through `vendorSubmission.public.getById()` and check its shop. A request without it is a global-only probe; scoped writers receive `403`.

Add `OrderTimeline.idempotencyKey` with a unique sparse index. `appendTimelineOnce()` must upsert by that key, and shipment tracking must call it with `SHIPMENT_TRACKING_AVAILABLE:<shipmentId>:<trackingNumber>`. Replaying tracking then repairs a failed status/timeline side effect without producing duplicate evidence.

- [x] **Step 4: Run focused GREEN tests**

Run:

```powershell
npx jest src/test/shipment/services/shipmentWebhook.service.test.js src/test/shipment/services/shipment.service.test.js src/test/shipment/repositories/shipment.repository.test.js src/test/order/services/orderTimeline.service.test.js --runInBand
```

Expected: PASS.

- [x] **Step 5: Run integration verification and commit**

Run:

```powershell
npx jest src/test/shipment --runInBand
npx jest src/test/order --runInBand
npm run test:architecture -- --runInBand
```

Commit:

```powershell
git add src/modules/shipment src/modules/order src/test/shipment src/test/order docs/superpowers/plans/2026-07-20-shipment-tracking-edge-cases.md
git commit -m "fix(shipment): secure tracking ingestion retries"
```
