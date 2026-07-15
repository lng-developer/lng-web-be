# Report API

Report APIs are read-only dashboard endpoints. They aggregate live data through module public ports and do not persist report snapshots.

All routes require `REPORTS:READ`.

## GET /api/reports/finance/daily

Daily finance totals from `FinanceSnapshot.calculatedAt`.

Query:
- `dateFrom`, `dateTo`
- `shopId`
- `salesChannelCode`
- `marketplaceCode`

Returns compact rows:
- `date`
- `shopId`
- `salesChannelCode`
- `marketplaceCode`
- `itemCount`
- `revenueAmount`
- `baseCostAmount`
- `grossProfitAmount`
- `grossMarginBps`
- `missingCostCount`
- `currency`

## GET /api/reports/vendor/performance

Vendor handoff performance from `VendorSubmission`, with shipped counts from `Shipment`.

Query:
- `dateFrom`, `dateTo`
- `shopId`
- `vendorId`
- `page` default `1`
- `limit` default `100`, max `500`

Returns paginated compact rows:
- `items`
- `total`
- `page`
- `limit`

Each item:
- `vendorId`
- `vendorCode`
- `vendorName`
- `readyCount`
- `submittedCount`
- `failedCount`
- `cancelledCount`
- `shippedCount`
- `successRateBps`
- `avgProcessingHours`

## GET /api/reports/operations/overview

Operations counts for dashboard cards.

Query:
- `dateFrom`, `dateTo`
- `shopId`
- `salesChannelCode`
- `marketplaceCode`

Returns:
- `orderItemsByStatus`
- `productionByStatus`
- `productionBlockers`
- `vendorSubmissionsByStatus`
- `shipmentsByStatus`
