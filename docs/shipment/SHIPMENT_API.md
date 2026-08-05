# Shipment API

`shipment` owns tracking state after a vendor submission has been submitted. It supports manual tracking, vendor API polling, and vendor tracking webhooks; it does not call carrier APIs, buy labels, or support multi-package shipments.

## Auth

All endpoints require:

```text
Authorization: Bearer <accessToken>
```

- Read routes require `SHIPMENTS:READ`.
- Create/update routes require `SHIPMENTS:WRITE`.
- Shop-scoped access is enforced from the shipment `shopId`.
- Vendor tracking webhooks use the provider-specific `x-vendor-webhook-secret`; query tokens and global fallback secrets are rejected.

## Workflow

1. `VendorSubmission.status = SUBMITTED`.
2. A successful or replayed vendor submission automatically ensures the shipment exists.
3. Shipment starts as `TRACKING_PENDING`.
4. Operator enters `carrier + trackingNumber`.
5. Shipment becomes `SHIPPED`, and order item status is transitioned through `order.public.transitionItemStatus(..., 'SHIPPED')`.
6. Operator may later mark shipment `DELIVERED`, `EXCEPTION`, `RETURNED`, or `CANCELLED`.

## Endpoints

### GET `/api/shipments`

Query:

- `status`: `TRACKING_PENDING`, `SHIPPED`, `DELIVERED`, `EXCEPTION`, `RETURNED`, `CANCELLED`
- `vendorSubmissionId`
- `orderId`
- `orderItemId`
- `shopId`
- `carrier`
- `dateFrom`, `dateTo`
- `page`
- `limit`

### GET `/api/shipments/summary`

Query:

- `status`
- `shopId`
- `carrier`
- `dateFrom`, `dateTo`

Response:

```json
{
  "total": 100,
  "trackingPending": 20,
  "shipped": 50,
  "delivered": 25,
  "exception": 3,
  "cancelled": 2,
  "byStatus": {},
  "byCarrier": []
}
```

### GET `/api/shipments/:id`

Returns one shipment.

### GET `/api/shipments/order-items/:orderItemId`

Returns the latest shipment for an order item, or `null`.

### POST `/api/shipments/from-vendor-submissions/:vendorSubmissionId`

Creates a `TRACKING_PENDING` shipment from a submitted vendor submission.

Rules:

- vendor submission must be `SUBMITTED`
- repeated create for the same active vendor submission returns the existing shipment
- order item is transitioned to `TRACKING_PENDING`

### PATCH `/api/shipments/:id/tracking`

Body:

```json
{
  "carrier": "USPS",
  "trackingNumber": "<trackingNumber>",
  "trackingUrl": "<trackingUrl>",
  "note": "Vendor tracking"
}
```

Rules:

- `carrier` and `trackingNumber` are required
- shipment status becomes `SHIPPED`
- `shippedAt` is set if empty
- order item is transitioned to `SHIPPED`
- `TRACKING_AVAILABLE` is appended to the order timeline

### PATCH `/api/shipments/:id/status`

Body:

```json
{
  "status": "DELIVERED",
  "note": "Delivered by carrier"
}
```

Allowed statuses:

- `DELIVERED`
- `EXCEPTION`
- `RETURNED`
- `CANCELLED`

`DELIVERED` sets `deliveredAt`. When all non-cancelled items in the Order have delivered Shipments, the parent Order is marked delivered. `DELIVERED`, `RETURNED`, and `CANCELLED` are terminal states.

### POST `/api/shipments/:id/recheck`

Requires `SHIPMENTS:WRITE`. The server loads the Shipment and derives vendor, provider, and vendor external order ID from its Vendor Submission snapshot. The request has no provider identity body.

### POST `/api/shipments/vendor-tracking/recheck`

Requires `SHIPMENTS:WRITE`.

Compatibility endpoint for batch/internal callers. `vendorSubmissionId` is required; `provider` and `externalOrderId` are optional match-only fields and mismatches are rejected before a provider request.

Body:

```json
{
  "provider": "MERCHIZE",
  "externalOrderId": "<vendorExternalOrderId>",
  "dateFrom": "2026-06-01",
  "dateTo": "2026-07-17",
  "vendorSubmissionId": "<vendorSubmissionId>"
}
```

Behavior:

- with submitted `vendorSubmissionId`: creates/reuses a `TRACKING_PENDING` shipment; it updates tracking only when a usable tracking number is returned
- with submitted `vendorSubmissionId` and no usable tracking: returns the pending shipment without setting `SHIPPED`, transitioning the order item, or appending a tracking timeline event
- `dateFrom` / `dateTo` are the internal date filter contract; each adapter maps them to vendor-specific params/body when supported
- unsupported provider returns `400 VALIDATION_ERROR`
- vendor API errors return `409 CONFLICT_ERROR` with provider/status context only

Tracking safety invariants:

| Input | Result |
| --- | --- |
| Same tracking replay after `DELIVERED` | `200`; shipment record is unchanged, but an interrupted order-status or idempotent timeline handoff may be repaired |
| Changed tracking after `DELIVERED` | `409 CONFLICT_ERROR` |
| Webhook with no usable tracking number | `202 TRACKING_NOT_FOUND`, no shipment or item-status mutation |
| Read-only recheck without `vendorSubmissionId` and no usable tracking | `200`, normalized result only, no DB mutation |
| Submission-bound recheck with no usable tracking | `200`, `TRACKING_PENDING` shipment may be created/reused; no `SHIPPED` or tracking-timeline mutation |
| Webhook cannot resolve a submission | `202 SUBMISSION_NOT_FOUND`, sanitized `SKIPPED` log |
| Batch recheck vendor failure | one `FAILED` row; remaining rows continue |

### POST `/api/shipments/vendor-tracking/recheck-submitted`

Requires `SHIPMENTS:WRITE`.

Batch rechecks submitted vendor submissions that already have `provider` and `vendorExternalOrderId`. This is the manual trigger behind the optional scheduler.

Body:

```json
{
  "provider": "PRINTWAY",
  "shopId": "<shopId>",
  "limit": 50
}
```

Rules:

- `limit` defaults to `50` and is capped at `100`
- submitted submissions without tracking references are ignored by the source query
- delivered shipments are skipped
- each item is isolated; one vendor API failure does not fail the whole batch
- the source query is bounded to at most `100` submissions, even when a larger limit is requested
- the endpoint may create/reuse a shipment and update tracking when vendor tracking is found

Response:

```json
{
  "checked": 20,
  "applied": 12,
  "skipped": 7,
  "failed": 1,
  "items": []
}
```

Tracking credentials are resolved from the persisted Vendor integration using `vendorId + provider`; live adapters never fall back to shared environment credentials.

### GET `/api/shipments/vendor-webhooks/:provider`

Verifies a provider webhook endpoint. Requires the provider-specific webhook secret header.

```text
x-vendor-webhook-secret: <secret>
```

Secret lookup:

1. `VENDOR_WEBHOOK_SECRET_<PROVIDER>`
2. `VENDOR_WEBHOOK_SECRET`

### POST `/api/shipments/vendor-webhooks/:provider`

Receives vendor tracking webhooks and normalizes common payload shapes.

Body should include `vendorSubmissionId`, `orderItemId`, or a vendor order id such as `vendorExternalOrderId` / `order_id`.

Example:

```json
{
  "vendorSubmissionId": "<vendorSubmissionId>",
  "tracking": {
    "trackingNumber": "<trackingNumber>",
    "carrierName": "USPS",
    "url": "<trackingUrl>"
  },
  "status": "shipped"
}
```

Behavior:

- missing submission returns `202` with `SUBMISSION_NOT_FOUND`
- missing tracking returns `202` with `TRACKING_NOT_FOUND`
- missing tracking does not transition the shipment or order item
- unresolved submissions are logged as `SKIPPED` outcomes with a sanitized raw payload; secret, token, authorization, and password keys are stripped
- if only vendor order id is provided, shipment resolves `provider + vendorExternalOrderId`
- valid tracking creates shipment if needed, updates tracking, and logs success
- `status=delivered` also marks shipment `DELIVERED`

### GET `/api/shipments/vendor-webhooks/logs`

Requires `SHIPMENTS:READ` or `SHIPMENTS:WRITE`.

Global readers see all webhook logs, including unresolved legacy logs with a `null` `shopId`. Scoped readers see only logs for their allowed `shopId` values; unresolved or legacy `null`-shop logs are not visible to scoped readers.

Query:

- `provider`
- `outcome`: `SUCCESS`, `ERROR`, `SKIPPED`
- `vendorSubmissionId`
- `orderItemId`
- `dateFrom`
- `dateTo`
- `page`
- `limit`

## Workbench

`GET /api/orders/workbench` includes compact shipment data per item:

```json
{
  "tracking": {
    "shipmentId": "<shipmentId>",
    "carrier": "USPS",
    "trackingNumber": "<trackingNumber>",
    "trackingUrl": "<trackingUrl>",
    "status": "SHIPPED",
    "shippedAt": "2026-07-06T00:00:00.000Z",
    "deliveredAt": null,
    "note": "Vendor tracking"
  }
}
```

## Deferred

- carrier API
- additional vendor tracking adapters
- label purchase
- multi-package shipment
- return/refund handling
- finance reconciliation
