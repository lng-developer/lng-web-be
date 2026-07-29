# Report API

Report APIs are read-only dashboard endpoints. They aggregate live data through module public ports and do not persist report snapshots.

All routes require `REPORTS:READ`.

Common query filters are `dateFrom`, `dateTo`, `shopId`, `salesChannelCode`, `marketplaceCode`, `sellerEmployeeCode`, and `teamId`. Unsupported filters are stripped by validation.

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

## GET /api/reports/finance/daily-profit

Returns daily total-cost P&L rows, including revenue, fees, refunds, discounts, fulfillment cost, gross profit, ads spend, net profit, margin, and missing-cost count.

## GET /api/reports/finance/by-seller

Returns profitability grouped by seller and currency, including attributed team/department, operating cost, and net profit.

## GET /api/reports/finance/by-team

Returns profitability grouped by team and currency, including seller count, operating cost, and net profit.

## GET /api/reports/buyers/insights

Returns Order buyer totals and new-versus-returning buyer metrics for the selected scope.

## GET /api/reports/ads/channel-performance

Returns ad spend/sales performance grouped by channel, marketplace, and currency, joined with Order new-buyer counts.

## GET /api/reports/ads/by-seller

Returns seller-attributed ad spend and sales metrics. Rows without attribution remain in the unassigned seller bucket.

## GET /api/reports/ads/daily

Returns daily ad spend, sales, impressions, clicks, and conversion metrics.

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
