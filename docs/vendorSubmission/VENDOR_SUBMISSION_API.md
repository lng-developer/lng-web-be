# Vendor Submission API

`vendorSubmission` owns the manual handoff state after a production task is ready to send to a vendor. V1 does not call vendor APIs, create shipments, or create finance records.

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
4. Operator marks the submission `SUBMITTED`, `FAILED`, or `CANCELLED`.
5. When marked submitted, production is updated through `production.public.markSentToVendor()`.

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

- vendor API connector
- vendor webhook
- shipment/tracking creation
- invoice/finance
- vendor-specific payload templates
