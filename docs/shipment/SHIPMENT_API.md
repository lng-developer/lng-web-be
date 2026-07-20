# Shipment API

`shipment` owns tracking state after a vendor submission has been submitted. V1 supports manual tracking entry and vendor tracking webhooks; it does not call vendor APIs, carrier APIs, buy labels, or support multi-package shipments.

## Auth

All endpoints require:

```text
Authorization: Bearer <accessToken>
```

- Read routes require `SHIPMENTS:READ`.
- Create/update routes require `SHIPMENTS:WRITE`.
- Shop-scoped access is enforced from the shipment `shopId`.
- Vendor tracking webhooks use `x-vendor-webhook-secret` or `?token=` and do not use bearer auth.

## Workflow

1. `VendorSubmission.status = SUBMITTED`.
2. Operator creates a shipment from the vendor submission.
3. Shipment starts as `TRACKING_PENDING`.
4. Operator enters `carrier + trackingNumber`.
5. Shipment becomes `SHIPPED`, and order item status is transitioned through `order.public.transitionItemStatus(..., 'SHIPPED')`.
6. Operator may later mark shipment `DELIVERED`, `EXCEPTION`, or `CANCELLED`.

## Endpoints

### GET `/api/shipments`

Query:

- `status`: `TRACKING_PENDING`, `SHIPPED`, `DELIVERED`, `EXCEPTION`, `CANCELLED`
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
- `CANCELLED`

`DELIVERED` sets `deliveredAt`. V1 does not transition order item to delivered because the current order item state machine has no `DELIVERED` item status.

### POST `/api/shipments/vendor-tracking/recheck`

Requires `SHIPMENTS:WRITE`.

Pulls tracking from a vendor API. V1 supports `LENFUL`, `MERCHIZE`, and `PRINTWAY`; it is read-only unless `vendorSubmissionId` is provided.

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

- without `vendorSubmissionId`: returns normalized vendor tracking only; no DB mutation
- with submitted `vendorSubmissionId`: creates/reuses shipment and updates tracking
- `dateFrom` / `dateTo` are the internal date filter contract; each adapter maps them to vendor-specific params/body when supported
- unsupported provider returns `400 VALIDATION_ERROR`
- vendor API errors return `409 CONFLICT_ERROR` with provider/status context only

Tracking safety invariants:

| Input | Result |
| --- | --- |
| Same tracking replay after `DELIVERED` | `200`, no data mutation |
| Changed tracking after `DELIVERED` | `409 CONFLICT_ERROR` |
| Webhook/recheck with no usable tracking number | `202 TRACKING_NOT_FOUND`, no item-status mutation |
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

Env:

```text
LENFUL_API_BASE_URL=https://s-lencam.lenful.com/api
LENFUL_ACCESS_TOKEN=...
MERCHIZE_API_BASE_URL=https://bo-group-1-2.merchize.com/403c7ev/bo-api
MERCHIZE_ACCESS_TOKEN=...
PRINTWAY_API_BASE_URL=https://apis.printway.io
PRINTWAY_ACCESS_TOKEN=...
VENDOR_TRACKING_RECHECK_ENABLED=false
VENDOR_TRACKING_RECHECK_INTERVAL_MS=900000
VENDOR_TRACKING_RECHECK_LIMIT=50
```

### GET `/api/shipments/vendor-webhooks/:provider`

Verifies a provider webhook endpoint. Requires webhook shared secret.

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
- unresolved submissions are logged as sanitized `SKIPPED` outcomes without vendor payloads or secrets
- if only vendor order id is provided, shipment resolves `provider + vendorExternalOrderId`
- valid tracking creates shipment if needed, updates tracking, and logs success
- `status=delivered` also marks shipment `DELIVERED`

### GET `/api/shipments/vendor-webhooks/logs`

Requires `SHIPMENTS:READ`.

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
- vendor API submission
- label purchase
- multi-package shipment
- return/refund handling
- finance reconciliation
