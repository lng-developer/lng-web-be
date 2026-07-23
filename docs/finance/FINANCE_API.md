# Finance API

`finance` owns order-item financial snapshots. V1 is manual recalculation only: no vendor invoices, settlement imports, payable reconciliation, or automatic triggers.

## Auth

All endpoints require:

```text
Authorization: Bearer <accessToken>
```

- Read routes require `FINANCE:READ`.
- Recalculate and import routes require `FINANCE:WRITE`.
- Import batch and imported-source-data routes require `FINANCE:READ`; reprocessing a batch requires `FINANCE:WRITE`.
- Shop-scoped access is enforced from the snapshot or loaded order item `shopId`.

## Workflow

1. Mapping resolves a fulfillment plan with `costEstimate`.
2. Marketplace settlement/transaction files populate fee/refund source collections.
3. Ads report files populate daily ad spend collections.
4. Operator or background tooling calls recalculate for an order item.
5. Finance stores a deterministic snapshot of revenue, cost, fee/refund placeholders, and margin.
6. Reports can read finance snapshots without recalculating from order/mapping DTOs.

## Source Collections

- `AdsSpendDaily`: rows from ads report CSV such as `Date`, `Campaign Name`, `Spend`, `7 Day Total Sales`.
- `MarketplaceSettlement`: settlement header rows from Amazon settlement TXT.
- `MarketplaceSettlementLedgerLine`: raw settlement/transaction ledger rows from settlement TXT or transaction CSV.
- `MarketplaceFeeLine`: normalized fee lines used by profit calculation.
- `RefundRecord`: normalized refund lines used by profit calculation.

## Endpoints

### POST `/api/finance/imports/transactions`

Imports marketplace transaction CSV/TXT rows.

Content type: `multipart/form-data`

Form fields:

| Field | Required | Notes |
| --- | --- | --- |
| `file` | yes | CSV/TXT file, max `25MB`. |
| `shopId` | yes | Shop id. |
| `salesChannelCode` | yes | For example `AMAZON`. |
| `marketplaceCode` | yes | For example `AMAZON_US`. |
| `sourceRef` | no | Defaults to `finance-import`. |
| `dryRun` | no | Defaults to `true`. Use `false` to persist. |

### POST `/api/finance/imports/settlements`

Same multipart contract as transaction import. Use for settlement files.

### POST `/api/finance/imports/ads`

Same multipart contract as transaction import. Use for ads report files.

### GET `/api/finance/import-batches`

Returns immutable import batch history. Query filters: `sourceType` (`ADS`, `SETTLEMENTS`, or `TRANSACTIONS`), `shopId`, `salesChannelCode`, `marketplaceCode`, `status` (`PROCESSING`, `COMPLETED`, `PARTIAL_FAILED`, or `FAILED`), `dateFrom`, `dateTo`, `page`, and `limit`.

Response data:

```json
{ "items": ["FinanceImportBatch"], "total": 0, "page": 1, "limit": 20 }
```

### GET `/api/finance/import-batches/:batchId`

Returns one immutable import batch when the caller has read access to its shop.

### POST `/api/finance/import-batches/:batchId/reprocess`

Replays the stored source asset into a new import batch. The original batch and its source records are never modified.

### GET `/api/finance/imported-data/:sourceType`

Returns paginated, read-only normalized source data. `sourceType` must be `ads`, `settlements`, or `transactions`. Query filters: `shopId`, `salesChannelCode`, `marketplaceCode`, `dateFrom`, `dateTo`, `page`, and `limit`.

Response data:

```json
{ "items": ["ImportedSourceRecord"], "total": 0, "page": 1, "limit": 20 }
```

These contracts expose no source-data mutation endpoint.

### GET `/api/finance/snapshots`

Query:

- `orderId`
- `externalOrderId`: case-insensitive marketplace order ID search.
- `orderItemId`
- `shopId`
- `salesChannelCode`
- `marketplaceCode`
- `snapshotStatus`: `ESTIMATED`, `MISSING_COST`
- `costStatus`: `PRESENT`, `MISSING`
- `page`
- `limit`

Response:

```json
{
  "items": ["FinanceSnapshot"],
  "pagination": {
    "total": 815,
    "page": 1,
    "limit": 20
  },
  "summaryByCurrency": ["OrderPnlCurrencySummary"]
}
```

All amounts are integer minor units and `summaryByCurrency` is grouped by currency. It uses the same filters and shop access scope as `items`; pagination does not limit the totals.

`items[].orderPnl` is the per-order-item profitability breakdown:

```json
{
  "marketplaceFeeAmount": 300,
  "refundAmount": 200,
  "discountAmount": 100,
  "baseCostAmount": 894,
  "additionalFulfillmentCostAmount": 50,
  "totalCostAmount": 944,
  "totalDeductionAmount": 1544,
  "profitAmount": 2436
}
```

Formula:

```text
profitAmount = customerPaidAmount - marketplaceFeeAmount - refundAmount - discountAmount - totalCostAmount
```

`additionalFulfillmentCostAmount` is `max(totalCostAmount - baseCostAmount, 0)`. When an item has no total fulfillment cost, `baseCostAmount`, `additionalFulfillmentCostAmount`, `totalCostAmount`, `totalDeductionAmount`, and `profitAmount` are `null`.

`summaryByCurrency[]` is the full filtered total for one currency:

```json
{
  "currency": "USD",
  "revenueAmount": 10000,
  "marketplaceFeeAmount": 900,
  "refundAmount": 200,
  "discountAmount": 300,
  "baseCostAmount": 4000,
  "additionalFulfillmentCostAmount": 500,
  "totalCostAmount": 4500,
  "totalDeductionAmount": 5900,
  "profitAmount": 4100,
  "missingCostCount": 0
}
```

If any item in a currency has missing cost, its `totalCostAmount`, `additionalFulfillmentCostAmount`, `totalDeductionAmount`, and `profitAmount` are `null` to avoid presenting an incomplete P&L as final.

Ads spend remains in aggregate financial reports and is excluded from per-order P&L until it can be attributed to an individual order.

### GET `/api/finance/order-items/:orderItemId/snapshot`

Returns the current finance snapshot for an order item, or `null`.

### POST `/api/finance/order-items/:orderItemId/recalculate`

Recalculates and upserts the snapshot for one order item.

Rules:

- revenue is `itemPriceAmount + shippingPriceAmount`
- current fee/refund sources are optional `item.externalData.finance.feeAmount/refundAmount`; missing values default to `0`
- cost is loaded from `mapping.public.getFulfillmentPlanForOrderItem`
- shipment reference is loaded from `shipment.public.getShipmentByOrderItem`
- missing cost estimate stores `snapshotStatus = MISSING_COST`
- repeated recalculation replaces the previous snapshot for the same `orderItemId`

Profit formula:

```text
profit = revenue - fee - refund - baseCost - discount
```

`baseCost` is the `BASE_COST` cost line from the fulfillment plan. `totalCostAmount` remains stored for reporting, but it is not used as the profit base in V1.

### POST `/api/finance/orders/:orderId/recalculate`

Manually recalculates all current order items for one order.

Rules:

- loads items through `order.public.listItemsByOrder(orderId)`
- recalculates each item using the same item-level rules above
- returns compact order totals and the recalculated item snapshots
- does not trigger automatically from mapping, production, vendor submission, or shipment

Response summary:

```json
{
  "orderId": "string",
  "itemCount": 2,
  "recalculatedCount": 2,
  "missingCostCount": 0,
  "summary": {
    "revenueAmount": 1000,
    "baseCostAmount": 400,
    "grossProfitAmount": 500
  }
}
```

### GET `/api/finance/orders/:orderId/summary`

Returns totals from existing finance snapshots for the order.

This endpoint does not recalculate missing item snapshots.

## Snapshot Shape

```json
{
  "id": "string",
  "orderId": "string",
  "externalOrderId": "113-1234567-1234567",
  "orderItemId": "string",
  "shopId": "string",
  "revenue": {
    "customerPaidAmount": 3980,
    "feeAmount": 300,
    "refundAmount": 200,
    "discountAmount": 100,
    "currency": "USD"
  },
  "cost": {
    "baseCostAmount": 894,
    "totalCostAmount": 894,
    "costStatus": "PRESENT",
    "costLines": []
  },
  "margin": {
    "grossProfitAmount": 2486,
    "grossMarginBps": 6246
  },
  "snapshotStatus": "ESTIMATED",
  "calculatedAt": "2026-07-06T00:00:00.000Z"
}
```

## Deferred

- vendor invoice tracking
- payable reconciliation
- landed-cost calculation
- automatic recalculation triggers
