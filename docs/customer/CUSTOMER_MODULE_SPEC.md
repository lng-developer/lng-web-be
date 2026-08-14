# Customer Module Spec

## Goal

Create a lightweight customer module that turns order buyer data into an operational customer profile. Phase 1 is not a full CRM; it is a customer read model for identifying new/returning customers, customer value, support risk, and care follow-up.

## Scope

- Build `src/modules/customer`.
- Source customer facts from the order module through public ports/events, not direct order model imports.
- Expose customer list, detail, timeline, notes, segments, and dashboard summary APIs.
- Keep marketplace privacy constraints: store masked contact fields already available from order data; do not invent or unmask PII.
- Support backfill from existing orders with a dry-run option.

## Non-Goals

- Email campaign automation.
- Loyalty points.
- Full CRM sales pipeline.
- Customer merge UI beyond a backend-safe duplicate report.
- Direct cross-module queries into order internals.

## Permissions

Add permissions:

- `CUSTOMERS:READ`
- `CUSTOMERS:WRITE`
- `CUSTOMERS:MANAGE`

`CUSTOMERS:WRITE` covers notes and care status. `CUSTOMERS:MANAGE` covers segment rules, merge/backfill execution, and high-risk metadata changes.

## Backend Module Shape

```
src/modules/customer/
  controllers/
    customer.controller.js
    customerNote.controller.js
    customerSegment.controller.js
  dtos/
    customer.dto.js
    customerNote.dto.js
    customerSummary.dto.js
  models/
    customer.model.js
    customerNote.model.js
    customerSegment.model.js
    customerEvent.model.js
  repositories/
    customer.repository.js
    customerNote.repository.js
    customerSegment.repository.js
    customerEvent.repository.js
  routes/
    customer.routes.js
  services/
    customer.service.js
    customerProjection.service.js
    customerSegment.service.js
  validators/
    customer.validator.js
  public.js
```

## Data Model

### Customer

Primary identity should prefer stable marketplace buyer identity. Use contact fields only as fallback keys because many channels mask email/phone.

Fields:

- `identityKey`: stable unique key, derived from `{salesChannelCode}:{marketplaceCode}:{externalBuyerId || emailMasked || phoneMasked || normalizedNameShippingHash}`.
- `salesChannelCode`
- `marketplaceCode`
- `externalBuyerId`
- `name`
- `emailMasked`
- `phoneMasked`
- `firstOrderId`
- `firstOrderAt`
- `lastOrderId`
- `lastOrderAt`
- `orderCount`
- `orderItemCount`
- `totalRevenueAmount`
- `totalCostAmount`
- `currency`
- `averageOrderValue`
- `countries`: string array
- `shops`: array of `{ shopId, name }`
- `status`: `ACTIVE | WATCHLIST | BLOCKED | ARCHIVED`
- `lifecycle`: `NEW | RETURNING | VIP | AT_RISK | ISSUE_PRONE`
- `careStatus`: `NONE | NEEDS_FOLLOW_UP | IN_PROGRESS | RESOLVED`
- `riskFlags`: array of `{ code, count, lastSeenAt }`
- `lastIssueAt`
- `lastCareNoteAt`
- timestamps

Indexes:

- unique `{ identityKey: 1 }`
- `{ lifecycle: 1, lastOrderAt: -1 }`
- `{ careStatus: 1, lastIssueAt: -1 }`
- `{ totalRevenueAmount: -1 }`
- text or normalized search fields for name/email/order ids.

### CustomerNote

- `customerId`
- `body`
- `type`: `GENERAL | CARE | ISSUE | REFUND | ADDRESS | VIP`
- `createdBy`
- `createdAt`
- `updatedAt`

### CustomerEvent

Append-only timeline event:

- `customerId`
- `eventType`: `ORDER_CREATED | ORDER_CASE_OPENED | ADDRESS_ISSUE | SHIPMENT_EXCEPTION | NOTE_ADDED | SEGMENT_CHANGED`
- `sourceModule`
- `sourceId`
- `message`
- `occurredAt`
- `metadata`

### CustomerSegment

Phase 1 can be mostly static, but store rules so the UI can explain why a customer belongs to a segment.

- `code`
- `name`
- `description`
- `rule`
- `status`

Default segments:

- `NEW`: first order within configured recent window or `orderCount === 1`
- `RETURNING`: `orderCount >= 2`
- `VIP`: revenue or order count threshold
- `AT_RISK`: recent issue/refund/shipment exception
- `ISSUE_PRONE`: repeated address/case/refund flags

## Public Port

`src/modules/customer/public.js`:

```js
module.exports = {
  upsertFromOrderSnapshot,
  recordCustomerEvent,
  getCustomerById,
  listCustomerOptions,
}
```

`upsertFromOrderSnapshot(snapshot)` receives a DTO produced by order public code, not raw Mongoose documents.

Snapshot shape:

```js
{
  orderId,
  externalOrderId,
  orderedAt,
  salesChannelCode,
  marketplaceCode,
  shop: { id, name },
  buyer: {
    name,
    emailMasked,
    phoneMasked,
    externalBuyerId,
  },
  shippingAddress: {
    countryCode,
    country,
    addressValidationStatus,
  },
  pricing: {
    customerPaidAmount,
    totalCostAmount,
    currency,
  },
  itemCount,
  quantity,
  caseStatus,
}
```

## Projection Flow

1. Order import creates or updates normalized order through the order module.
2. Order module emits/calls a public customer projection with a safe order snapshot.
3. Customer module computes identity key.
4. Customer is upserted idempotently.
5. Stats are incremented only once per order. Store seen order ids in a bounded projection/event collection or use an idempotency collection keyed by `customerId + orderId`.
6. Segment and care flags are recalculated.
7. Customer event is appended.

Do not call customer internals from order services. Either:

- order public port calls `customer.public.upsertFromOrderSnapshot`, or
- a shared event/job consumer dispatches to the customer public port.

## REST API

Base path: `/api/customers`

### List Customers

`GET /api/customers`

Query:

- `page`, `limit`
- `search`
- `lifecycle`
- `careStatus`
- `status`
- `countryCode`
- `shopId`
- `salesChannelCode`
- `orderedFrom`, `orderedTo`
- `minOrderCount`
- `minRevenue`
- `sort`: `lastOrderDesc | revenueDesc | orderCountDesc | firstOrderDesc`

Response:

```js
{
  items: CustomerDTO[],
  pagination: { total, page, limit }
}
```

### Customer Summary

`GET /api/customers/summary`

Response:

```js
{
  total,
  newCount,
  returningCount,
  vipCount,
  atRiskCount,
  issueProneCount,
  needsFollowUpCount,
  totalRevenueAmount,
  averageOrderValue,
  byCountry: [{ countryCode, count }],
  byLifecycle: { NEW, RETURNING, VIP, AT_RISK, ISSUE_PRONE }
}
```

### Customer Detail

`GET /api/customers/:id`

Includes customer profile, stats, flags, latest orders summary, latest notes, and latest events.

### Timeline

`GET /api/customers/:id/timeline?page=1&limit=50`

Returns `CustomerEventDTO[]`.

### Notes

- `POST /api/customers/:id/notes`
- `PATCH /api/customers/:id/notes/:noteId`
- `DELETE /api/customers/:id/notes/:noteId`

### Care Status

`PATCH /api/customers/:id/care-status`

Body:

```js
{ careStatus, note }
```

### Backfill

`POST /api/customers/backfill`

Body:

```js
{ dryRun: true, from, to, batchSize }
```

Only `CUSTOMERS:MANAGE`.

## DTO Rules

- Do not leak raw Mongo documents.
- Do not expose unmasked PII.
- Include display-ready flags:
  - `isNew`
  - `isReturning`
  - `isVip`
  - `needsFollowUp`
  - `lastOrderAgeDays`

## Tests

Minimum backend tests:

- identity key derivation prefers external buyer id.
- fallback identity handles masked email/phone.
- upsert is idempotent per order id.
- new customer becomes returning after second unique order.
- VIP segment applies at configured threshold.
- address issue adds risk flag and event.
- list filters by lifecycle/care status.
- summary counts match seeded customers.
- notes require `CUSTOMERS:WRITE`.
- backfill dry-run does not write.

## Rollout

1. Add models, repository, DTO, service, routes, permissions.
2. Add customer public port.
3. Wire order projection after normalized order upsert.
4. Add dry-run backfill script/API.
5. Add FE screens behind permission gate.
6. Backfill staging data, compare customer count and order count.
7. Enable production projection.
8. Run production dry-run, then execute backfill after approval.
