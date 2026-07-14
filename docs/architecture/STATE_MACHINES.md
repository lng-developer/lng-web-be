# State Machines

This document defines baseline state contracts for import and customization workflows. Keep state transitions explicit and service-owned.

## External Order Import Job

```text
PENDING
  -> PARSING
  -> IMPORTING
  -> COMPLETED
```

Failure and stop states:

```text
PARSING -> FAILED
IMPORTING -> PARTIAL_FAILED
IMPORTING -> FAILED
PENDING/PARSING/IMPORTING -> CANCELLED
PARTIAL_FAILED -> IMPORTING
FAILED -> PENDING
```

Expected statuses:

- `PENDING`: job created, not started
- `PARSING`: source file/report is being parsed
- `IMPORTING`: normalized records are being handed to `order`
- `COMPLETED`: all importable records completed
- `PARTIAL_FAILED`: some records failed and issues remain open
- `FAILED`: job-level failure prevented completion
- `CANCELLED`: operator/system stopped the job

## External Order Raw Record

Normalize status:

```text
PENDING -> NORMALIZED
PENDING -> FAILED
PENDING -> SKIPPED
FAILED -> PENDING
```

Import status:

```text
PENDING -> IMPORTED
PENDING -> FAILED
PENDING -> SKIPPED
FAILED -> PENDING
```

Rules:

- Normalize status tracks source-to-DTO conversion.
- Import status tracks DTO-to-order public port result.
- Skipped rows should include a reason through an issue or error field.

## External Order Import Issue

```text
OPEN -> RESOLVED
OPEN -> IGNORED
IGNORED -> OPEN
RESOLVED -> OPEN
```

Issue types:

- `NORMALIZE_FAILED`
- `SHOP_RESOLVE_FAILED`
- `ORDER_IMPORT_FAILED`
- `DUPLICATE_RECORD`
- `MISSING_REQUIRED_FIELD`
- `CUSTOMIZATION_PARSE_PENDING`

Severity:

- `INFO`
- `WARNING`
- `ERROR`
- `CRITICAL`

## Customization Payload

```text
PENDING
  -> DOWNLOADING
  -> DOWNLOADED
  -> EXTRACTING
  -> PARSED
```

Review and failure states:

```text
PENDING/DOWNLOADING/DOWNLOADED/EXTRACTING -> FAILED
PENDING/DOWNLOADING/DOWNLOADED/EXTRACTING -> NEEDS_REVIEW
FAILED -> PENDING
NEEDS_REVIEW -> PENDING
NEEDS_REVIEW -> PARSED
```

Rules:

- `PENDING`: payload stored, parse not started
- `DOWNLOADING`: external assets are being downloaded
- `DOWNLOADED`: assets are available
- `EXTRACTING`: parser is deriving structured customization data
- `PARSED`: customization is ready for downstream modules
- `NEEDS_REVIEW`: automated parse is insufficient
- `FAILED`: retryable or terminal error recorded with `errorCode` and `errorMessage`

## Order Item

Order item status is validated by the `order` module. Other modules must request
status changes through `order/public.js`; they must not update `OrderItem.status`
directly.

```text
NEW -> MAPPING_PENDING
NEW -> CUSTOMIZATION_PENDING
CUSTOMIZATION_PENDING -> CUSTOMIZATION_PARSED
CUSTOMIZATION_PENDING -> MAPPING_PENDING
CUSTOMIZATION_PARSED -> MAPPING_PENDING
CUSTOMIZATION_PARSED -> FULFILLMENT_PLANNING
CUSTOMIZATION_PARSED -> FULFILLMENT_READY
MAPPING_PENDING -> FULFILLMENT_PLANNING
MAPPING_PENDING -> FULFILLMENT_READY
MAPPING_PENDING -> NEED_PRODUCTION
MAPPING_PENDING -> READY_TO_SEND_VENDOR
FULFILLMENT_PLANNING -> NEED_PRODUCTION
FULFILLMENT_PLANNING -> READY_TO_SEND_VENDOR
FULFILLMENT_READY -> NEED_PRODUCTION
FULFILLMENT_READY -> READY_TO_SEND_VENDOR
NEED_PRODUCTION -> IN_PRODUCTION
NEED_PRODUCTION -> READY_TO_SEND_VENDOR
NEED_PRODUCTION -> QC_REJECTED
IN_PRODUCTION -> READY_TO_SEND_VENDOR
IN_PRODUCTION -> QC_REJECTED
QC_REJECTED -> IN_PRODUCTION
QC_REJECTED -> NEED_PRODUCTION
READY_TO_SEND_VENDOR -> SENT_TO_VENDOR
SENT_TO_VENDOR -> TRACKING_PENDING
SENT_TO_VENDOR -> SHIPPED
TRACKING_PENDING -> SHIPPED
```

Operational stop transitions:

```text
NEW/CUSTOMIZATION_PENDING/CUSTOMIZATION_PARSED/MAPPING_PENDING/FULFILLMENT_PLANNING/FULFILLMENT_READY/NEED_PRODUCTION/IN_PRODUCTION/QC_REJECTED/READY_TO_SEND_VENDOR -> CANCELLED
NEW/CUSTOMIZATION_PENDING/CUSTOMIZATION_PARSED/MAPPING_PENDING/FULFILLMENT_PLANNING/FULFILLMENT_READY/NEED_PRODUCTION/IN_PRODUCTION/QC_REJECTED/READY_TO_SEND_VENDOR/SENT_TO_VENDOR/TRACKING_PENDING -> FAILED
```

Terminal statuses:

```text
SHIPPED
CANCELLED
REFUNDED
FAILED
```

Rules:

- Same-status transitions are idempotent no-ops.
- `DELIVERED` is not an order item status. Delivered is shipment-level evidence only.
- `mapping` owns `FulfillmentPlan.status`, not `OrderItem.status`.
- `production` owns production task state and requests item status transitions after task state changes.
- Only `order/public.js` status transition ports may change `OrderItem.status`.
- Imports, scripts, backfills, and other modules must not call `orderItem.repository.updateStatus()` directly.

## Parent Order Aggregate

`Order.status` is derived from order item lifecycle state. `DELIVERED` is not an
order status; delivered orders are identified by `Order.deliveredAt`.

```text
all items SHIPPED -> SHIPPED
some items SHIPPED -> PARTIALLY_SHIPPED
any active workflow item -> PROCESSING
all items CANCELLED -> CANCELLED
all items REFUNDED -> REFUNDED
all items FAILED -> FAILED
otherwise -> IMPORTED
```

Rules:

- Delivered shipments leave their order items as `SHIPPED`.
- `Order.deliveredAt` is set only when all item shipments for the order are delivered.
- Delivered tab uses `Order.deliveredAt != null`.
- Shipped tab uses `Order.status = SHIPPED` and `Order.deliveredAt = null`.
- Shipped mixed with cancelled/refunded remains `PARTIALLY_SHIPPED`.

## Fulfillment Plan

The `mapping` module owns fulfillment plan status.

```text
READY
BLOCKED
```

Rules:

- `READY`: listing, customization, vendor product, and vendor cost center are resolved.
- `BLOCKED`: mapping cannot resolve a required dependency.
- A READY plan may trigger production through `production/public.js`.
- Mapping must not update `OrderItem.status` directly.

## Production Task

The `production` module owns production task state.

```text
BLOCKED -> NEED_SCALE
NEED_SCALE -> QC_PENDING
QC_PENDING -> READY_TO_SEND_VENDOR
QC_PENDING -> QC_REJECTED
QC_REJECTED -> NEED_SCALE
READY_TO_SEND_VENDOR -> SENT_TO_VENDOR
```

Rules:

- Production maps task aggregate state to order item state through `order/public.js`.
- `READY_TO_SEND_VENDOR` on a production task maps to `OrderItem.status = READY_TO_SEND_VENDOR`.
- Production must not bypass order's transition validator.

## Vendor Submission

The `vendorSubmission` module owns vendor handoff state.

```text
DRAFT -> READY
READY -> SUBMITTED
READY -> FAILED
SUBMITTED -> FAILED
DRAFT -> CANCELLED
READY -> CANCELLED
FAILED -> CANCELLED
```

Rules:

- `READY` means a safe submission snapshot exists for a production task.
- `SUBMITTED` means the operator marked the vendor handoff complete.
- Marking a submission `SUBMITTED` must call `production/public.js`; `vendorSubmission` must not update production internals directly.
- Vendor API calls, shipment creation, and finance are outside vendorSubmission V1. Vendor tracking webhooks belong to `shipment`.

## Shipment

The `shipment` module owns tracking state.

```text
TRACKING_PENDING -> SHIPPED
TRACKING_PENDING -> CANCELLED
SHIPPED -> DELIVERED
SHIPPED -> EXCEPTION
SHIPPED -> CANCELLED
EXCEPTION -> SHIPPED
EXCEPTION -> CANCELLED
```

Rules:

- `TRACKING_PENDING` is created from a submitted vendor submission.
- Entering `carrier` and `trackingNumber` marks the shipment `SHIPPED` and requests `OrderItem.status = SHIPPED` through `order/public.js`.
- `DELIVERED` sets shipment `deliveredAt`; it must not request `OrderItem.status = DELIVERED`.
- When every item shipment on the order is delivered, shipment requests `Order.deliveredAt` through `order/public.js`.
- Carrier APIs, labels, returns, and finance reconciliation are outside V1. Vendor tracking webhooks may update shipment tracking through shared-secret endpoints.

## Service Ownership

State transitions belong in services. Controllers request actions; repositories persist transitions; models validate allowed values and indexes.
