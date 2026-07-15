# Finance Module

`finance` owns financial snapshots used for cost, revenue, and margin reporting.

## Current Scope

Implemented V1 concepts:

- `FinanceSnapshot`
- manual order-item snapshot recalculation
- manual order-level snapshot recalculation
- order finance summary from existing snapshots
- source schemas for ads spend, marketplace settlement ledger, fee lines, and refunds

Deferred concepts:

- vendor invoices
- payable reconciliation
- settlement/ads file import services
- automatic recalculation triggers
- landed-cost calculation

## Boundary Rules

- Finance may call `order/public.js`, `mapping/public.js`, and `shipment/public.js`.
- Finance must not import order, mapping, shipment, vendor, production, or vendorSubmission internals.
- Finance V1 does not call vendor APIs, carrier APIs, production, vendorSubmission, or SP-API.
- Finance snapshots are derived records; order remains revenue source and mapping remains estimated cost source.
- Fee/refund/ads source records belong to finance; import orchestration can live in `integration`, but normalized finance rows stay here.
- V1 profit uses `itemPrice + shippingPrice - fee - refund - BASE_COST - discount`; `totalCostAmount` is retained for reporting but not used as the profit base.

## Public Ports

Current finance public ports:

```js
getSnapshotByOrderItem(orderItemId, authContext)
listSnapshotsByOrderItemIds(orderItemIds, authContext)
recalculateOrderItem(orderItemId, authContext)
recalculateOrder(orderId, authContext)
```

Public methods should return DTOs or `null`, not raw Mongo documents.
