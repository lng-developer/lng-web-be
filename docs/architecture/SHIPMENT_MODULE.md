# Shipment Module

`shipment` owns shipment/tracking state after a vendor submission is submitted.

## Current Scope

Implemented V1 concepts:

- `Shipment`
- create tracking-pending shipment from submitted vendor submission
- update carrier/tracking number
- ingest vendor tracking webhooks through shared-secret endpoints
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
- Shipment owns shipment status; order owns order item status.
- Entering tracking requests `OrderItem.status = SHIPPED` through `order.public.transitionItemStatus()`.
- Delivered is tracked on `Shipment.deliveredAt`; V1 does not add a delivered order item status.
- Vendor webhooks may create/update shipments only after resolving a submitted vendor submission through `vendorSubmission/public.js`.

## Public Ports

Current shipment public ports:

```js
getShipmentByOrderItem(orderItemId, authContext)
listSummariesByOrderItemIds(orderItemIds, authContext)
```

Public methods should return DTOs or `null`, not raw Mongo documents.
