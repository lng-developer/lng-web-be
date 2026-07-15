# Production Module

`production` owns internal POD production task state: scale work, QC, blockers, assignee evidence, and readiness to send to vendor.

## Current Scope

Implemented V1 concepts:

- `ProductionTask`
- scale file checks
- QC pass/reject
- design assignment/claim/note
- handoff readiness: `READY_TO_SEND_VENDOR`

Deferred concepts:

- vendor submission persistence
- shipment tracking
- finance
- vendor API submission
- carrier API

## Boundary Rules

- Production may call `order/public.js` to request order item status transitions and append timeline events.
- Production may call `mapping/public.js`, `catalog/public.js`, `customization/public.js`, `media/public.js`, and `design/public.js` to build/recheck task context and create missing PSD tasks.
- Production must not import internals from those modules.
- Production owns `ProductionTask.status`; order owns `OrderItem.status`.
- Production is the source of truth for whether a task can be sent to vendor.
- VendorSubmission must call `production.public.markSentToVendor()`; it must not update production internals.

## Mapping Handoff

`mapping` can trigger `createOrRecheckTaskForOrderItem()` after saving a `READY`
fulfillment plan. Production then derives task state from the task aggregate:

- missing template/PSD/customer image -> `BLOCKED` or `NEED_SCALE`, item status `NEED_PRODUCTION`
- scaled output uploaded -> `QC_PENDING`, item status `IN_PRODUCTION`
- QC passed -> `READY_TO_SEND_VENDOR`, item status `READY_TO_SEND_VENDOR`
- vendor submission sent -> `SENT_TO_VENDOR`, item status `SENT_TO_VENDOR`

Production blockers should remain visible in the task DTO. Mapping should not hide
production blockers by forcing a vendor-ready state.

When a task is blocked by `PSD_MISSING`, production best-effort calls
`design.public.createPsdTemplateTaskFromListing()` for the listing. The design
task creation is idempotent and must not fail production task creation/recheck.

## Public Ports

Current production public ports include:

```js
createOrRecheckTaskForOrderItem(orderItemId, authContext)
getTaskById(taskId, authContext)
getTaskByOrderItem(orderItemId, authContext)
listTaskSummariesByOrderItemIds(orderItemIds, authContext)
uploadScaledFile(taskId, fileCheckId, mediaAssetId, authContext)
submitQc(taskId, payload, authContext)
markSentToVendor(taskId, vendorSubmissionId, authContext)
recheckPsdBlockedTasks({ shopId, limit }, authContext)
```

Public methods should return DTOs, not raw Mongo documents.

## PSD Blocked Recheck

Operators can recheck production tasks blocked by missing PSD after design QC approval:

```http
POST /api/production/tasks/recheck-psd-blocked
```

This scans only `PSD_MISSING` blockers, caps `limit` at `100`, and reruns the normal production task recheck. It does not auto-pass QC or send vendor submissions.
