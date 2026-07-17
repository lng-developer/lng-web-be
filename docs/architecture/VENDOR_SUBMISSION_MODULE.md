# Vendor Submission Module

`vendorSubmission` owns the handoff record after production is ready to send an item to a vendor. It stores a safe snapshot for operator review, manual handoff, and supported vendor submit adapters.

## Current Scope

Implemented V1 concepts:

- `VendorSubmission`
- payload preview
- Merchize dry-run/submit adapter
- mark submitted
- mark failed
- cancel

Deferred concepts:

- vendor payload template
- webhook handling
- shipment creation
- invoice/finance
- submit adapters for vendors other than Merchize

## Boundary Rules

- VendorSubmission may call `production/public.js`.
- VendorSubmission must not import production internals.
- VendorSubmission may call supported vendor submit APIs through local submit adapters.
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
