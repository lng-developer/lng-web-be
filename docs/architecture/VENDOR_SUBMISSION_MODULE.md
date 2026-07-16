# Vendor Submission Module

`vendorSubmission` owns the manual handoff record after production is ready to send an item to a vendor. It stores a safe snapshot for operator review and status tracking.

## Current Scope

Implemented V1 concepts:

- `VendorSubmission`
- payload preview
- mark submitted
- mark failed
- cancel

Deferred concepts:

- vendor API connector
- vendor payload template
- webhook handling
- shipment creation
- invoice/finance

## Boundary Rules

- VendorSubmission may call `production/public.js`.
- VendorSubmission must not import production internals.
- VendorSubmission must not call vendor APIs in V1.
- VendorSubmission does not own tracking; shipment owns tracking.
- VendorSubmission does not own order item status; production/order own status changes.
- Payload preview must not expose `localPath`, provider secrets, storage paths, signed source URLs, API keys, or tokens.

## Public Ports

Current vendorSubmission public ports:

```js
getById(vendorSubmissionId)
getByOrderItemId(orderItemId)
getByProductionTaskId(productionTaskId)
```

Public methods should return DTOs or `null`, not raw Mongo documents.
