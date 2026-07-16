# Vendor Module

`vendor` owns vendor master data, vendor products, and vendor cost-center pricing rows. It does not own mapping decisions, production tasks, vendor submission state, shipment tracking, or finance invoices in V1.

## Current Scope

Implemented V1 concepts:

- `Vendor`
- `VendorProduct`
- `VendorCostCenter`
- vendor template import scripts for master data migration

Deferred concepts:

- vendor API credentials
- vendor adapter registry
- vendor webhooks
- vendor invoice tracking
- vendor-specific payload templates

## Boundary Rules

- Vendor may call `catalog/public.js` to validate product type groups.
- Vendor must not import catalog internals.
- Vendor must not import order, customization, mapping, production, vendorSubmission, shipment, or finance internals.
- Vendor cost center rows are the V1 source for vendor base cost and shipping/additional cost inputs.
- Vendor does not decide which vendor is used for an order item; mapping owns that decision.

## Public Ports

Current vendor public ports include:

```js
getVendorById(vendorId, options)
findVendorByCode(code, options)
getVendorProductById(vendorProductId, options)
findVendorProductByCode({ vendorId, code }, options)
listActiveVendorProductsByProductTypeGroup(productTypeGroupId)
listActiveVendorCostCenters(vendorProductId)
```

Public methods should return DTOs or `null`, not raw Mongo documents.
