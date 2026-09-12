# Report API

Report APIs are read-only dashboard endpoints. They aggregate live data through module public ports and do not persist report snapshots.

All routes require `REPORTS:READ`.

Common query filters are `dateFrom`, `dateTo`, `shopId`, `salesChannelCode`, `marketplaceCode`, `sellerEmployeeCode`, and `teamId`. Unsupported filters are stripped by validation.

Finance snapshot dates are filtered and grouped in `Asia/Ho_Chi_Minh`; the date range is inclusive.

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
- `totalCostAmount` (or `null` when at least one item is missing cost)
- `additionalFulfillmentCostAmount` (or `null` when missing cost)
- `marketplaceFeeAmount`
- `refundAmount`
- `discountAmount`
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

The rows also expose `totalCostAmount`, `additionalFulfillmentCostAmount`, `marketplaceFeeAmount`, `refundAmount`, and `discountAmount` so the UI can show each net-profit deduction. Missing fulfillment cost remains `null` rather than being displayed as zero.

## GET /api/reports/finance/orders-profitability

Returns paginated direct P&L per order and currency. It intentionally includes only costs directly recorded against that order; unallocated costs such as account-level ads or operating costs are not estimated per order.

Query:

- common report filters
- `dateBasis` (`CALCULATED_AT` or `ORDERED_AT`)
- `page` default `1`
- `limit` default `20`, max `100`

Returns `{ items, pagination, summaryByCurrency }`. Each item includes `orderId`, `externalOrderId`, `reportDate`, shop/channel/marketplace, `currency`, `itemCount`, `revenueAmount`, `baseCostAmount`, `totalCostAmount`, `marketplaceFeeAmount`, `refundAmount`, `discountAmount`, `profitAmount`, `marginBps`, and `missingCostCount`.

`summaryByCurrency` is an additive selected-filter overview. Each row includes `currency`, `orderCount`, `costedOrderCount`, `missingCostOrderCount`, `revenueAmount`, `totalCostAmount`, `profitAmount`, `marginBps`, `profitableOrderCount`, and `lossOrderCount`. `totalCostAmount`, `profitAmount`, and `marginBps` only aggregate orders whose fulfillment cost is complete; they are not estimated from incomplete orders.

## GET /api/reports/finance/by-seller

Returns profitability grouped by seller and currency, including attributed team/department, operating cost, and net profit.

## GET /api/reports/finance/seller-daily

Returns one P&L row per calculation date, seller, and currency. It includes revenue, base and additional fulfillment cost, marketplace fee, refund, discount, tax, operating cost, seller-attributed ad spend, and net profit. Rows with missing fulfillment cost keep `totalCostAmount` and `additionalFulfillmentCostAmount` as `null`, and retain `partialGrossProfitAmount` and `partialNetProfitAmount` for their costed items. These subtotals allocate the seller-day operating cost and ad spend by the costed items' share of seller-day revenue; `costedItemCount` declares that coverage.

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

## GET /api/reports/ads/seller-daily

Returns daily ad management metrics for each attributed employee and currency, including `date`, `sellerEmployeeCode`, `sellerName`, `spendAmount`, `attributedSalesAmount`, `impressions`, `clicks`, `attributedOrdersCount`, `ctrBps`, `conversionBps`, and `cpaAmount`.

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
