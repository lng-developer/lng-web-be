# ADR 0005: Manual Vendor Submission And Shipment V1

## Status

Accepted

## Context

After production QC passes, the system needs a handoff state for sending work to a vendor and a tracking state for shipping. Vendor API submission and carrier APIs are not stable enough to build against yet, but vendor tracking webhooks can be normalized into the shipment lifecycle.

## Decision

`vendorSubmission` owns vendor handoff state.

`shipment` owns tracking state.

V1 is manual/API-ready:

- `vendorSubmission` creates a safe snapshot from `ProductionTask.status = READY_TO_SEND_VENDOR`.
- marking a vendor submission `SUBMITTED` calls `production.public.markSentToVendor()`.
- `shipment` creates a tracking record from `VendorSubmission.status = SUBMITTED`.
- entering carrier/tracking data marks the shipment `SHIPPED` and asks `order.public.transitionItemStatus()` to move the item to `SHIPPED`.
- vendor tracking webhooks are accepted by `shipment`, protected by a shared secret, logged, and normalized into existing shipment updates.

No vendor API submission, carrier API, shipment label purchase, finance, or invoice behavior is included in V1.

## Consequences

- Production remains the source of truth for whether an item can be sent to vendor.
- VendorSubmission owns only submission state and safe handoff snapshots.
- Shipment owns tracking lifecycle and exposes compact tracking summaries to order workbench.
- Order owns `OrderItem.status`; downstream modules request transitions only through `order/public.js`.
- Vendor API submission and carrier tracking ingestion can be added later without changing the shipment contract.
