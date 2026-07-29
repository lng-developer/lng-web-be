# POD Assignee Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit six persisted inbox notification types for explicitly assigned POD operators when order, production, vendor-submission, or shipment work needs attention.

**Architecture:** Add direct calls from each owning state-transition service to `notification/public.js` after persistence succeeds. Use the existing best-effort `notify()` port and deterministic transition keys; downstream modules resolve order ownership only through `order/public.js` and swallow recipient-resolution failures after logging them.

**Tech Stack:** Node.js, CommonJS, Jest, Mongoose-backed notification inbox.

## Global Constraints

- Implement only `ORDER_ASSIGNED`, `PRODUCTION_ASSIGNED`, `PRODUCTION_BLOCKED`, `PRODUCTION_QC_REJECTED`, `VENDOR_SUBMISSION_FAILED`, and `SHIPMENT_EXCEPTION`.
- Notify only an explicit `assignedStaffId` or `assignedDesignUserId`; skip unassigned work.
- Notification delivery and recipient lookup are best-effort and must not roll back a successful business transition.
- Cross-module imports must use the target module's `public.js`.
- Do not add an event bus, queue, scheduler, broadcast recipient lookup, delivery channel, preference model, dependency, or API.
- Do not notify a designer for a self-claimed production task; the claim itself is already the operator's action.

---

### Task 1: Order assignment notification

**Files:**
- Modify: `src/modules/order/services/orderAssignment.service.js`
- Test: `src/test/order/services/orderAssignment.service.test.js`

**Interfaces:**
- Consumes: `notificationPublic.notify({ recipientAccountId, type, title, message, relatedResource, deduplicationKey })`
- Produces: `ORDER_ASSIGNED` inbox rows for the newly persisted `assignedStaffId`.

- [ ] **Step 1: Write the failing service tests**

Mock `../../../modules/notification/public` with `notify: jest.fn()`. Make the repository return an updated order containing a fixed `updatedAt`, then assert:

```js
expect(notificationPublic.notify).toHaveBeenCalledWith({
  recipientAccountId: assignedStaffId,
  type: 'ORDER_ASSIGNED',
  title: 'Order assigned',
  message: 'You were assigned an order that needs processing.',
  relatedResource: { type: 'order', id: orderId },
  deduplicationKey: `ORDER_ASSIGNED:${orderId}:${assignedStaffId}:${updatedAt.toISOString()}`,
});
```

Add one test where `assignedStaffId` is `null` and assert `notify` is not called. Add one test where `notify` resolves `{ delivered: false }` and assert `assignStaff()` still returns the updated order.

- [ ] **Step 2: Run the order assignment test and verify failure**

Run: `npx jest src/test/order/services/orderAssignment.service.test.js --runInBand`

Expected: FAIL because `orderAssignment.service.js` does not call the notification public port.

- [ ] **Step 3: Implement the minimal post-persistence call**

Import `../../notification/public`. After `updateAssignedStaff()` succeeds, call `notify()` only when `updated.assignedStaffId` exists. Build the key from `updated._id || updated.id`, the recipient, and `new Date(updated.updatedAt).toISOString()`.

```js
if (updated.assignedStaffId) {
  await notificationPublic.notify({
    recipientAccountId: String(updated.assignedStaffId),
    type: 'ORDER_ASSIGNED',
    title: 'Order assigned',
    message: 'You were assigned an order that needs processing.',
    relatedResource: { type: 'order', id: String(updated._id || updated.id) },
    deduplicationKey: `ORDER_ASSIGNED:${updated._id || updated.id}:${updated.assignedStaffId}:${new Date(updated.updatedAt).toISOString()}`,
  });
}
```

- [ ] **Step 4: Run the focused test**

Run: `npx jest src/test/order/services/orderAssignment.service.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit the order slice**

```bash
git add src/modules/order/services/orderAssignment.service.js src/test/order/services/orderAssignment.service.test.js
git commit -m "feat(notification): alert assigned order staff"
```

### Task 2: Production assignment and attention notifications

**Files:**
- Modify: `src/modules/production/services/productionTask.service.js`
- Test: `src/test/production/services/productionTask.service.test.js`

**Interfaces:**
- Consumes: `notificationPublic.notify(...)`
- Produces: `PRODUCTION_ASSIGNED`, `PRODUCTION_BLOCKED`, and `PRODUCTION_QC_REJECTED` notifications for `assignedDesignUserId`.

- [ ] **Step 1: Write failing production tests**

Mock `../../../modules/notification/public`. Add focused assertions for:

```js
expect(notificationPublic.notify).toHaveBeenCalledWith(expect.objectContaining({
  recipientAccountId: designerId,
  type: 'PRODUCTION_ASSIGNED',
  relatedResource: { type: 'productionTask', id: taskId },
}));
```

Cover these cases independently:

- `assignDesignTask()` notifies the persisted assignee with a key containing `updated.assignedAt.toISOString()`.
- `bulkAssignDesignTasks()` inherits the same behavior through `assignDesignTask()`; no separate emission is added.
- `claimDesignTask()` does not notify the claimant.
- `createOrRecheckTaskForOrderItem()` emits `PRODUCTION_BLOCKED` only when an existing assigned task changes from a non-`BLOCKED` status to persisted `BLOCKED`.
- Rechecking an already-`BLOCKED` task does not emit it again.
- `submitQc(..., { decision: 'REJECTED' })` emits `PRODUCTION_QC_REJECTED` to the persisted assignee.
- Missing `assignedDesignUserId` skips blocked and rejected notifications.
- A `{ delivered: false }` result never changes the production method's returned DTO.

- [ ] **Step 2: Run the production test and verify failure**

Run: `npx jest src/test/production/services/productionTask.service.test.js --runInBand`

Expected: FAIL because none of the three notification types are emitted.

- [ ] **Step 3: Implement three direct post-transition calls**

Import `../../notification/public`. Add only these calls:

```js
await notificationPublic.notify({
  recipientAccountId: String(updated.assignedDesignUserId),
  type: 'PRODUCTION_ASSIGNED',
  title: 'Production task assigned',
  message: 'You were assigned a production task.',
  relatedResource: { type: 'productionTask', id: String(updated._id || updated.id) },
  deduplicationKey: `PRODUCTION_ASSIGNED:${updated._id || updated.id}:${updated.assignedDesignUserId}:${new Date(updated.assignedAt).toISOString()}`,
});
```

For `PRODUCTION_BLOCKED`, require `existing`, `existing.status !== BLOCKED`, `task.status === BLOCKED`, and `task.assignedDesignUserId`. For `PRODUCTION_QC_REJECTED`, require `updated.assignedDesignUserId`. Use `updated.updatedAt` as each transition version and the messages `Your production task is blocked and needs attention.` and `Your production task failed QC and needs rework.` respectively.

- [ ] **Step 4: Run the production test**

Run: `npx jest src/test/production/services/productionTask.service.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit the production slice**

```bash
git add src/modules/production/services/productionTask.service.js src/test/production/services/productionTask.service.test.js
git commit -m "feat(notification): alert assigned production staff"
```

### Task 3: Vendor submission failure notification

**Files:**
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Test: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`

**Interfaces:**
- Consumes: `orderPublic.findById(orderId)` and `notificationPublic.notify(...)`.
- Produces: `VENDOR_SUBMISSION_FAILED` notification for the owning order's `assignedStaffId`.

- [ ] **Step 1: Write failing vendor-submission tests**

Mock `../../../modules/order/public`, `../../../modules/notification/public`, and `../../../shared/utils/logger`. Make `repository.updateById()` return a failed row with fixed `updatedAt`. Assert the order owner receives:

```js
expect(notificationPublic.notify).toHaveBeenCalledWith(expect.objectContaining({
  recipientAccountId: assignedStaffId,
  type: 'VENDOR_SUBMISSION_FAILED',
  relatedResource: { type: 'vendorSubmission', id: submissionId },
}));
```

Add cases for no assigned owner, `orderPublic.findById()` rejection, and `{ delivered: false }`; all must still return the failed vendor-submission DTO. Assert a lookup rejection is logged without PII.

- [ ] **Step 2: Run the vendor-submission test and verify failure**

Run: `npx jest src/test/vendorSubmission/services/vendorSubmission.service.test.js --runInBand`

Expected: FAIL because `markFailed()` does not resolve the order owner or notify.

- [ ] **Step 3: Implement a local best-effort owner notifier**

Import `../../order/public`, `../../notification/public`, and the shared logger. Add a small local function used only by `markFailed()`:

```js
async function notifyOrderOwnerOfFailure(updated) {
  try {
    const order = await orderPublic.findById(updated.orderId);
    if (!order?.assignedStaffId) return;
    await notificationPublic.notify({
      recipientAccountId: String(order.assignedStaffId),
      type: 'VENDOR_SUBMISSION_FAILED',
      title: 'Vendor submission failed',
      message: 'A vendor submission for your order failed and needs attention.',
      relatedResource: { type: 'vendorSubmission', id: String(updated._id || updated.id) },
      deduplicationKey: `VENDOR_SUBMISSION_FAILED:${updated._id || updated.id}:${order.assignedStaffId}:${new Date(updated.updatedAt).toISOString()}`,
    });
  } catch (error) {
    logger.warn('vendor_submission_notification_failed', {
      submissionId: String(updated._id || updated.id),
      errorCode: error.code || errorCodes.INTERNAL_SERVER_ERROR,
    });
  }
}
```

Persist the failed state first, await the helper, then return the DTO.

- [ ] **Step 4: Run the vendor-submission test**

Run: `npx jest src/test/vendorSubmission/services/vendorSubmission.service.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit the vendor slice**

```bash
git add src/modules/vendorSubmission/services/vendorSubmission.service.js src/test/vendorSubmission/services/vendorSubmission.service.test.js
git commit -m "feat(notification): alert vendor submission failures"
```

### Task 4: Shipment exception notification and broad verification

**Files:**
- Modify: `src/modules/shipment/services/shipment.service.js`
- Test: `src/test/shipment/services/shipment.service.test.js`

**Interfaces:**
- Consumes: `orderPublic.findById(orderId)` and `notificationPublic.notify(...)`.
- Produces: `SHIPMENT_EXCEPTION` notification for the owning order's `assignedStaffId`; all six notification types remain architecture-compliant.

- [ ] **Step 1: Write failing shipment tests**

Extend the existing `order/public` mock with `findById`, mock `../../../modules/notification/public` and the shared logger, then assert a successful transition from `SHIPPED` to `EXCEPTION` sends:

```js
expect(notificationPublic.notify).toHaveBeenCalledWith(expect.objectContaining({
  recipientAccountId: assignedStaffId,
  type: 'SHIPMENT_EXCEPTION',
  relatedResource: { type: 'shipment', id: shipmentId },
}));
```

Also assert:

- Replaying an already-`EXCEPTION` state does not emit another notification.
- No assigned order owner skips delivery.
- Owner lookup rejection and `{ delivered: false }` do not change the returned shipment DTO.
- Owner lookup rejection logs only shipment ID and a stable error code.

- [ ] **Step 2: Run the shipment test and verify failure**

Run: `npx jest src/test/shipment/services/shipment.service.test.js --runInBand`

Expected: FAIL because `updateStatus()` does not emit `SHIPMENT_EXCEPTION`.

- [ ] **Step 3: Implement the local best-effort exception notifier**

Import `../../notification/public` and the shared logger. Add a local helper matching Task 3's error boundary but using:

```js
{
  recipientAccountId: String(order.assignedStaffId),
  type: 'SHIPMENT_EXCEPTION',
  title: 'Shipment exception',
  message: 'A shipment for your order has an exception and needs attention.',
  relatedResource: { type: 'shipment', id: String(updated._id || updated.id) },
  deduplicationKey: `SHIPMENT_EXCEPTION:${updated._id || updated.id}:${order.assignedStaffId}:${new Date(updated.updatedAt).toISOString()}`,
}
```

Call it only in the existing `status === shipmentStatuses.EXCEPTION` branch after persistence and timeline append succeed.

- [ ] **Step 4: Run syntax and focused tests**

Run:

```bash
node -c src/modules/order/services/orderAssignment.service.js
node -c src/modules/production/services/productionTask.service.js
node -c src/modules/vendorSubmission/services/vendorSubmission.service.js
node -c src/modules/shipment/services/shipment.service.js
npx jest src/test/order/services/orderAssignment.service.test.js src/test/production/services/productionTask.service.test.js src/test/vendorSubmission/services/vendorSubmission.service.test.js src/test/shipment/services/shipment.service.test.js src/test/notification --runInBand
```

Expected: all syntax checks exit 0; all selected test suites pass, with the existing DB-dependent notification integration suite allowed to skip when its test database is unavailable.

- [ ] **Step 5: Run architecture verification**

Run: `npm run test:architecture -- --runInBand`

Expected: PASS; every new cross-module import resolves through `public.js`.

- [ ] **Step 6: Inspect the complete diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff -- src/modules/order/services/orderAssignment.service.js src/modules/production/services/productionTask.service.js src/modules/vendorSubmission/services/vendorSubmission.service.js src/modules/shipment/services/shipment.service.js src/test/order/services/orderAssignment.service.test.js src/test/production/services/productionTask.service.test.js src/test/vendorSubmission/services/vendorSubmission.service.test.js src/test/shipment/services/shipment.service.test.js
```

Expected: only the four services and four focused test files are changed.

- [ ] **Step 7: Commit the shipment slice**

```bash
git add src/modules/shipment/services/shipment.service.js src/test/shipment/services/shipment.service.test.js
git commit -m "feat(notification): alert shipment exceptions"
```
