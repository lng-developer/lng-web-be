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
  "trackingNumber": "940011189922385",
  "trackingUrl": "https://tools.usps.com/go/TrackConfirmAction?tLabels=940011189922385",
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

Body must include either `vendorSubmissionId` or `orderItemId`.

Example:

```json
{
  "vendorSubmissionId": "660000000000000000000901",
  "tracking": {
    "trackingNumber": "940011189922385",
    "carrierName": "USPS",
    "url": "https://tools.usps.com/go/TrackConfirmAction?tLabels=940011189922385"
  },
  "status": "shipped"
}
```

Behavior:

- missing submission returns `202` with `SUBMISSION_NOT_FOUND`
- missing tracking returns `202` with `TRACKING_NOT_FOUND`
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
    "shipmentId": "660000000000000000000901",
    "carrier": "USPS",
    "trackingNumber": "940011189922385",
    "trackingUrl": "https://tools.usps.com/go/TrackConfirmAction?tLabels=940011189922385",
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
