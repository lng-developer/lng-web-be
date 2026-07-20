# Shipment Module

`shipment` owns shipment/tracking state after a vendor submission is submitted.

## Current Scope

Implemented V1 concepts:

- `Shipment`
- create tracking-pending shipment from submitted vendor submission
- update carrier/tracking number
- ingest vendor tracking webhooks through shared-secret endpoints
- pull tracking from supported vendor APIs for submitted vendor submissions
- optional tracking recheck scheduler, disabled by default
- store vendor webhook logs for operational audit
- mark delivered/exception/cancelled
- compact tracking summary for order workbench

Deferred concepts:

- carrier API
- shipping label purchase
- multi-package shipment
- returns/refunds
- finance reconciliation

## Boundary Rules

- Shipment may call `vendorSubmission/public.js` and `order/public.js`.
- Shipment must not import order or vendorSubmission internals.
- Shipment must not call carrier APIs or vendor submit APIs in V1.
- Shipment vendor API reads are limited to tracking lookup adapters.
- Shipment owns shipment status; order owns order item status.
- Entering tracking requests `OrderItem.status = SHIPPED` through `order.public.transitionItemStatus()`.
- Delivered is tracked on `Shipment.deliveredAt`; V1 does not add a delivered order item status.
- Vendor webhooks may create/update shipments only after resolving a submitted vendor submission through `vendorSubmission/public.js`.
- Vendor tracking batch recheck may list submitted submissions only through `vendorSubmission/public.js`.
- Tracking writes are idempotent: replaying the same tracking on a `DELIVERED` shipment returns `200` without mutation; changing it returns `409 CONFLICT_ERROR`.
- A webhook or recheck without a usable tracking number returns `202 TRACKING_NOT_FOUND` and must not mutate shipment or order-item status.
- An unresolved webhook submission returns `202 SUBMISSION_NOT_FOUND` and writes only a sanitized `SKIPPED` webhook-log outcome.
- Batch recheck is capped at 100 submissions and isolates vendor failures as per-row `FAILED` results so later rows continue.

## Public Ports

Current shipment public ports:

```js
getShipmentByOrderItem(orderItemId, authContext)
listSummariesByOrderItemIds(orderItemIds, authContext)
```

Public methods should return DTOs or `null`, not raw Mongo documents.
