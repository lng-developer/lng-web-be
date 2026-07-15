# Mapping Module

`mapping` owns fulfillment resolution: turning an order item into a vendor product and vendor cost center selection. It does not own order persistence, customization parsing, catalog data, vendor master data, production tasks, vendor submissions, or shipment tracking.

## Current Scope

Implemented V1 concepts:

- `FulfillmentPlan`: saved mapping result for an order item.
- SKU normalize rules: runtime canonical SKU transforms.
- SKU config rules: config code + product type signal to product type group.
- normalization rules: semantic customer input normalization.
- vendor routing rules: vendor priority by shop/channel/marketplace/product type.

Deferred concepts:

- vendor payload templates
- production task internals
- vendor API calls
- shipment/tracking
- finance or landed-cost reconciliation

## Boundary Rules

- Mapping may call `order/public.js`, `catalog/public.js`, `customization/public.js`, `vendor/public.js`, and `production/public.js`.
- Mapping must not import internals from those modules.
- Mapping must not update `OrderItem.status` directly.
- Preview is read-only.
- Persisted selections are created only through resolve/select flows.
- A `READY` fulfillment plan may trigger production recheck through `production/public.js`
  with a system handoff context.
- No Amazon SP-API, vendor API, shipment, or finance calls belong in mapping.

## Public Ports

Current mapping public ports include:

```js
getFulfillmentPlanForOrderItem(orderItemId)
listFulfillmentPlansForOrderItems(orderItemIds)
previewFulfillmentPlan(orderItemId, options, authContext)
resolveFulfillmentPlan(orderItemId, options, authContext)
selectFulfillmentPlan(orderItemId, payload, authContext)
```

Public methods should return DTOs, not raw Mongo documents.

## Handoff Contract

Mapping stops after a `FulfillmentPlan` is `READY`. Production owns the next state.

- If production recheck succeeds, `ProductionTask` stores blockers and requests the item status transition.
- If production recheck fails, mapping returns the `READY` plan and logs the warning.
- Mapping must not imply that production status changed unless production actually changed it.
