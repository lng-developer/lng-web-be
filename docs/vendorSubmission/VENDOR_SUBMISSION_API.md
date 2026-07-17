# Vendor Submission API

`vendorSubmission` owns the handoff state after a production task is ready to send to a vendor. V1 supports a Merchize submit adapter with safe dry-run first. It does not create shipments or finance records.

## Auth

All endpoints require:

```text
Authorization: Bearer <accessToken>
```

- Read routes require `VENDOR_SUBMISSIONS:READ`.
- Create/status action routes require `VENDOR_SUBMISSIONS:WRITE`.
- Shop-scoped access is enforced from the submission `shopId`.

## Workflow

1. Production task reaches `READY_TO_SEND_VENDOR`.
2. Create a vendor submission from the production task.
3. Operator reviews `payload-preview`.
4. Operator runs Merchize submit dry-run.
5. Operator fixes missing `image`, `merchize_sku`, shipping info, or design output if validation fails.
6. Operator explicitly submits with `dryRun=false`.
7. On successful submit, the submission becomes `SUBMITTED` and production is updated through `production.public.markSentToVendor()`.

## Endpoints

### GET `/api/vendor-submissions`

Query:

- `status`: `DRAFT`, `READY`, `SUBMITTED`, `FAILED`, `CANCELLED`
- `productionTaskId`
- `orderId`
- `orderItemId`
- `shopId`
- `vendorId`
- `dateFrom`, `dateTo`
- `page`
- `limit`

### GET `/api/vendor-submissions/summary`

Query:

- `status`
- `shopId`
- `vendorId`
- `dateFrom`, `dateTo`

Response:

```json
{
  "total": 100,
  "ready": 30,
  "submitted": 50,
  "failed": 10,
  "cancelled": 5,
  "byStatus": {},
  "byShop": [],
  "byVendor": []
}
```

### GET `/api/vendor-submissions/:id`

Returns one submission.

### POST `/api/vendor-submissions/from-production-tasks/:productionTaskId`

Creates a `READY` submission from a production task.

Rules:

- production task must be `READY_TO_SEND_VENDOR`
- repeated create for the same active production task returns the existing submission

### GET `/api/vendor-submissions/:id/payload-preview`

Returns the safe manual handoff snapshot:

- order item snapshot
- listing/template snapshot
- vendor product
- vendor cost center
- production file checks/output asset IDs

The response does not expose `localPath`, storage paths, provider secrets, API keys, tokens, or vendor credentials.

### POST `/api/vendor-submissions/:id/mark-submitted`

Marks the submission as `SUBMITTED` and calls production handoff.

This action is idempotent when the submission is already `SUBMITTED`.

Use this only for manual vendor portal handoff. For Merchize API submission, prefer `submit-to-vendor`.

### POST `/api/vendor-submissions/:id/submit-to-vendor`

Submits a READY vendor submission through a provider adapter. V1 supports only `MERCHIZE`.

Body:

```json
{
  "provider": "MERCHIZE",
  "dryRun": true
}
```

Rules:

- Requires `VENDOR_SUBMISSIONS:WRITE`.
- `dryRun` defaults to `true`.
- `dryRun=true` builds and validates the Merchize payload, but does not call Merchize and does not change submission status.
- `dryRun=false` calls Merchize `POST /order/external/orders`.
- The submission must be `READY`.
- On success, stores sanitized vendor response and `vendorExternalOrderId`, then marks submission `SUBMITTED`.
- Does not create shipment. Use shipment/tracking endpoints after submission.

Merchize required payload fields:

- `shipping_info.full_name`
- `shipping_info.address_1`
- `shipping_info.city`
- `shipping_info.state`
- `shipping_info.postcode`
- `shipping_info.country`
- `items[].merchize_sku` or `items[].sku`
- `items[].image`
- at least one design URL such as `items[].design_front`

Dry-run response:

```json
{
  "provider": "MERCHIZE",
  "dryRun": true,
  "validation": { "ok": true },
  "payload": {
    "order_id": "113-TEST",
    "shipping_info": {},
    "items": []
  }
}
```

### POST `/api/vendor-submissions/:id/mark-failed`

Body:

```json
{
  "failureReason": "Vendor portal rejected the order"
}
```

### POST `/api/vendor-submissions/:id/cancel`

Body:

```json
{
  "cancelReason": "Duplicate submission"
}
```

Submitted submissions cannot be cancelled in V1.

## Deferred

- vendor webhook
- shipment/tracking creation
- invoice/finance
- vendor-specific payload templates
- submit adapters for non-Merchize vendors
