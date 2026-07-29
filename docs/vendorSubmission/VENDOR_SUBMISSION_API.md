# Vendor Submission API

`vendorSubmission` owns the handoff state after a production task is ready to send to a vendor. It supports Merchize, Printway, and Lenful adapters with safe dry-run first. It does not create shipments or finance records.

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
4. Operator runs the selected provider's submit dry-run.
5. Operator fixes the provider-specific validation errors.
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

### POST `/api/vendor-submissions/recheck/production-tasks/:productionTaskId`

Re-evaluates one `READY_TO_SEND_VENDOR` Production task and idempotently creates or returns its active submission.

### POST `/api/vendor-submissions/recheck-ready-production-tasks`

Body:

```json
{
  "shopId": "optionalShopObjectId",
  "limit": 100
}
```

Processes up to 100 ready Production tasks within the caller's allowed Shop scope and returns an outcome for each task.

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

Use this only for manual vendor portal handoff. For supported provider API submission, prefer `submit-to-vendor`.

### POST `/api/vendor-submissions/:id/submit-to-vendor`

Submits a READY vendor submission through a provider adapter. Supported providers are `MERCHIZE`, `PRINTWAY`, and `LENFUL`.

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
- `dryRun=true` builds and validates the provider payload, but does not call the provider and does not change submission status.
- `dryRun=false` calls the selected provider adapter.
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

### POST `/api/vendor-submissions/:id/retry`

Moves a `FAILED` submission back to `READY` and appends status history.

Body:

```json
{
  "reason": "Corrected vendor SKU"
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
- additional vendor adapters
