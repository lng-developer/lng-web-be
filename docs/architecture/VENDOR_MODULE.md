# Vendor Module

`vendor` owns vendor master data, vendor products, and vendor cost-center pricing rows. It does not own mapping decisions, production tasks, vendor submission state, shipment tracking, or finance invoices in V1.

## Current Scope

Implemented V1 concepts:

- `Vendor`
- `VendorProduct`
- `VendorCostCenter`
- `VendorIntegrationConfig` for encrypted vendor API credential config
- vendor template import scripts for master data migration

Deferred concepts:

- vendor webhooks
- vendor invoice tracking
- vendor-specific payload templates

## Boundary Rules

- Vendor may call `catalog/public.js` to validate product type groups.
- Vendor must not import catalog internals.
- Vendor must not import order, customization, mapping, production, vendorSubmission, shipment, or finance internals.
- Vendor cost center rows are the V1 source for vendor base cost and shipping/additional cost inputs.
- Vendor does not decide which vendor is used for an order item; mapping owns that decision.
- Vendor owns credential storage only. Vendor API submit/read behavior belongs to `vendorSubmission` or `shipment` adapters through vendor public ports.
- Vendor credentials are encrypted at rest. API DTOs return configured booleans only, never access tokens, refresh tokens, usernames, passwords, provider paths, or secrets.

## Public Ports

Current vendor public ports include:

```js
getVendorById(vendorId, options)
findVendorByCode(code, options)
getVendorProductById(vendorProductId, options)
findVendorProductByCode({ vendorId, code }, options)
listActiveVendorProductsByProductTypeGroup(productTypeGroupId)
listActiveVendorCostCenters(vendorProductId)
getVendorIntegrationCredential(providerKey)
refreshVendorIntegrationCredential(providerKey)
```

Public methods should return DTOs or `null`, not raw Mongo documents.
