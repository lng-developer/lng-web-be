function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function toFinanceDailyDto(row = {}) {
  return {
    date: row.date,
    shopId: toId(row.shopId),
    salesChannelCode: row.salesChannelCode || null,
    marketplaceCode: row.marketplaceCode || null,
    itemCount: numberValue(row.itemCount),
    revenueAmount: numberValue(row.revenueAmount),
    baseCostAmount: numberValue(row.baseCostAmount),
    totalCostAmount: nullableNumber(row.totalCostAmount),
    additionalFulfillmentCostAmount: nullableNumber(row.additionalFulfillmentCostAmount),
    marketplaceFeeAmount: numberValue(row.marketplaceFeeAmount),
    refundAmount: numberValue(row.refundAmount),
    discountAmount: numberValue(row.discountAmount),
    grossProfitAmount: nullableNumber(row.grossProfitAmount),
    grossMarginBps:
      row.grossMarginBps === null || row.grossMarginBps === undefined ? null : numberValue(row.grossMarginBps),
    missingCostCount: numberValue(row.missingCostCount),
    estimatedFeeCount: numberValue(row.estimatedFeeCount),
    estimatedCostCount: numberValue(row.estimatedCostCount),
    currency: row.currency || null,
  };
}

function toFinanceOrderProfitabilityDto(row = {}) {
  return {
    orderId: toId(row.orderId),
    externalOrderId: row.externalOrderId || null,
    orderedAt: row.orderedAt || null,
    reportDate: row.reportDate || null,
    shopId: toId(row.shopId),
    salesChannelCode: row.salesChannelCode || null,
    marketplaceCode: row.marketplaceCode || null,
    currency: row.currency || null,
    itemCount: numberValue(row.itemCount),
    revenueAmount: numberValue(row.revenueAmount),
    baseCostAmount: numberValue(row.baseCostAmount),
    totalCostAmount: nullableNumber(row.totalCostAmount),
    lngFulfillmentFeeAmount: nullableNumber(row.lngFulfillmentFeeAmount),
    shippingCostAmount: nullableNumber(row.shippingCostAmount),
    vendorAdditionalCostAmount: nullableNumber(row.vendorAdditionalCostAmount),
    marketplaceFeeAmount: numberValue(row.marketplaceFeeAmount),
    refundAmount: numberValue(row.refundAmount),
    discountAmount: numberValue(row.discountAmount),
    profitAmount: nullableNumber(row.profitAmount),
    marginBps: nullableNumber(row.marginBps),
    missingCostCount: numberValue(row.missingCostCount),
  };
}

function toFinanceCoverageDto(row = {}) {
  return {
    currency: row.currency || null,
    itemCount: numberValue(row.itemCount),
    actualCount: numberValue(row.actualCount),
    estimatedCount: numberValue(row.estimatedCount),
    incompleteCostCount: numberValue(row.incompleteCostCount),
    missingDateCount: numberValue(row.missingDateCount),
    latestCalculatedAt: row.latestCalculatedAt || null,
  };
}

function toFinanceDailyProfitDto(row = {}) {
  return {
    ...toFinanceDailyDto(row),
    adSpendAmount: numberValue(row.adSpendAmount),
    netProfitAmount: nullableNumber(row.netProfitAmount),
    netMarginBps: row.netMarginBps === null || row.netMarginBps === undefined ? null : numberValue(row.netMarginBps),
  };
}

function toFinanceBySellerDto(row = {}) {
  return {
    sellerEmployeeCode: row.sellerEmployeeCode || null,
    sellerAccountId: toId(row.sellerAccountId),
    sellerName: row.sellerName || null,
    itemCount: numberValue(row.itemCount),
    revenueAmount: numberValue(row.revenueAmount),
    baseCostAmount: numberValue(row.baseCostAmount),
    grossProfitAmount: nullableNumber(row.grossProfitAmount),
    partialGrossProfitAmount: numberValue(row.partialGrossProfitAmount),
    costedItemCount: numberValue(row.costedItemCount),
    operatingCostAmount: numberValue(row.operatingCostAmount),
    operatingCostDays: numberValue(row.operatingCostDays),
    adSpendAmount: numberValue(row.adSpendAmount),
    netProfitAmount: nullableNumber(row.netProfitAmount),
    netMarginBps: row.netMarginBps === null || row.netMarginBps === undefined ? null : numberValue(row.netMarginBps),
    grossMarginBps:
      row.grossMarginBps === null || row.grossMarginBps === undefined ? null : numberValue(row.grossMarginBps),
    missingCostCount: numberValue(row.missingCostCount),
    estimatedFeeCount: numberValue(row.estimatedFeeCount),
    estimatedCostCount: numberValue(row.estimatedCostCount),
    currency: row.currency || null,
  };
}

function nullableNumber(value) {
  return value === null || value === undefined ? null : numberValue(value);
}

function toFinanceSellerDailyDto(row = {}) {
  return {
    date: row.date || null,
    sellerEmployeeCode: row.sellerEmployeeCode || null,
    sellerAccountId: toId(row.sellerAccountId),
    sellerName: row.sellerName || null,
    currency: row.currency || null,
    itemCount: numberValue(row.itemCount),
    orderCount: numberValue(row.orderCount),
    revenueAmount: numberValue(row.revenueAmount),
    baseCostAmount: numberValue(row.baseCostAmount),
    totalCostAmount: nullableNumber(row.totalCostAmount),
    additionalFulfillmentCostAmount: nullableNumber(row.additionalFulfillmentCostAmount),
    marketplaceFeeAmount: numberValue(row.marketplaceFeeAmount),
    refundAmount: numberValue(row.refundAmount),
    discountAmount: numberValue(row.discountAmount),
    taxAmount: numberValue(row.taxAmount),
    grossProfitAmount: nullableNumber(row.grossProfitAmount),
    partialGrossProfitAmount: nullableNumber(row.partialGrossProfitAmount),
    operatingCostAmount: numberValue(row.operatingCostAmount),
    adSpendAmount: numberValue(row.adSpendAmount),
    netProfitAmount: nullableNumber(row.netProfitAmount),
    partialNetProfitAmount: nullableNumber(row.partialNetProfitAmount),
    netMarginBps: nullableNumber(row.netMarginBps),
    missingCostCount: numberValue(row.missingCostCount),
    costedItemCount: numberValue(row.costedItemCount),
    estimatedFeeCount: numberValue(row.estimatedFeeCount),
    estimatedCostCount: numberValue(row.estimatedCostCount),
  };
}

function toFinanceByTeamDto(row = {}) {
  return {
    teamId: toId(row.teamId),
    teamName: row.teamName || null,
    teamCode: row.teamCode || null,
    departmentId: toId(row.departmentId),
    departmentName: row.departmentName || null,
    departmentCode: row.departmentCode || null,
    itemCount: numberValue(row.itemCount),
    revenueAmount: numberValue(row.revenueAmount),
    baseCostAmount: numberValue(row.baseCostAmount),
    grossProfitAmount: nullableNumber(row.grossProfitAmount),
    adSpendAmount: numberValue(row.adSpendAmount),
    activeSellerCount: numberValue(row.activeSellerCount),
    operatingCostAmount: numberValue(row.operatingCostAmount),
    operatingCostDays: numberValue(row.operatingCostDays),
    netProfitAmount: nullableNumber(row.netProfitAmount),
    netMarginBps: row.netMarginBps === null || row.netMarginBps === undefined ? null : numberValue(row.netMarginBps),
    grossMarginBps:
      row.grossMarginBps === null || row.grossMarginBps === undefined ? null : numberValue(row.grossMarginBps),
    missingCostCount: numberValue(row.missingCostCount),
    estimatedFeeCount: numberValue(row.estimatedFeeCount),
    estimatedCostCount: numberValue(row.estimatedCostCount),
    currency: row.currency || null,
  };
}

function toVendorPerformanceDto(row = {}) {
  return {
    vendorId: toId(row.vendorId),
    vendorCode: row.vendorCode || null,
    vendorName: row.vendorName || null,
    readyCount: numberValue(row.readyCount),
    submittedCount: numberValue(row.submittedCount),
    failedCount: numberValue(row.failedCount),
    cancelledCount: numberValue(row.cancelledCount),
    shippedCount: numberValue(row.shippedCount),
    successRateBps:
      row.successRateBps === null || row.successRateBps === undefined ? null : numberValue(row.successRateBps),
    avgProcessingHours:
      row.avgProcessingHours === null || row.avgProcessingHours === undefined ? null : Number(row.avgProcessingHours),
  };
}

function toBuyerInsightsDto(summary = {}) {
  return {
    knownBuyerCount: numberValue(summary.knownBuyerCount),
    newBuyerCount: numberValue(summary.newBuyerCount),
    returningBuyerCount: numberValue(summary.returningBuyerCount),
    repeatBuyerCount: numberValue(summary.repeatBuyerCount),
    unidentifiedOrderCount: numberValue(summary.unidentifiedOrderCount),
    totalOrderCount: numberValue(summary.totalOrderCount),
  };
}

function toAdsChannelPerformanceDto(row = {}) {
  const spendAmount = numberValue(row.spendAmount);
  const clicks = numberValue(row.clicks);
  const impressions = numberValue(row.impressions);
  const attributedOrdersCount = numberValue(row.attributedOrdersCount);
  const newBuyerCount = numberValue(row.newBuyerCount);
  return {
    salesChannelCode: row.salesChannelCode || null,
    marketplaceCode: row.marketplaceCode || null,
    currency: row.currency || null,
    spendAmount,
    attributedSalesAmount: numberValue(row.attributedSalesAmount),
    impressions,
    clicks,
    attributedOrdersCount,
    newBuyerCount,
    ctrBps: impressions > 0 ? Math.round((clicks / impressions) * 10000) : null,
    conversionBps: clicks > 0 ? Math.round((attributedOrdersCount / clicks) * 10000) : null,
    cpaAmount: newBuyerCount > 0 ? Math.round(spendAmount / newBuyerCount) : null,
  };
}

function toAdsSellerAttributionDto(row = {}) {
  const spendAmount = numberValue(row.spendAmount);
  const clicks = numberValue(row.clicks);
  const impressions = numberValue(row.impressions);
  const attributedOrdersCount = numberValue(row.attributedOrdersCount);
  return {
    sellerEmployeeCode: row.sellerEmployeeCode || 'UNASSIGNED',
    currency: row.currency || null,
    spendAmount,
    attributedSalesAmount: numberValue(row.attributedSalesAmount),
    impressions,
    clicks,
    attributedOrdersCount,
    ctrBps: impressions > 0 ? Math.round((clicks / impressions) * 10000) : null,
    conversionBps: clicks > 0 ? Math.round((attributedOrdersCount / clicks) * 10000) : null,
    cpaAmount: attributedOrdersCount > 0 ? Math.round(spendAmount / attributedOrdersCount) : null,
  };
}

function toAdsDailyDto(row = {}) {
  const spendAmount = numberValue(row.spendAmount);
  const clicks = numberValue(row.clicks);
  const impressions = numberValue(row.impressions);
  const attributedOrdersCount = numberValue(row.attributedOrdersCount);
  return {
    reportDate: row.reportDate || null,
    salesChannelCode: row.salesChannelCode || null,
    marketplaceCode: row.marketplaceCode || null,
    currency: row.currency || null,
    spendAmount,
    attributedSalesAmount: numberValue(row.attributedSalesAmount),
    impressions,
    clicks,
    attributedOrdersCount,
    ctrBps: impressions > 0 ? Math.round((clicks / impressions) * 10000) : null,
    conversionBps: clicks > 0 ? Math.round((attributedOrdersCount / clicks) * 10000) : null,
    cpaAmount: attributedOrdersCount > 0 ? Math.round(spendAmount / attributedOrdersCount) : null,
  };
}

function toAdsSellerDailyDto(row = {}) {
  const { reportDate, ...metrics } = toAdsDailyDto({ ...row, reportDate: row.date });
  return {
    ...metrics,
    date: reportDate,
    sellerEmployeeCode: row.sellerEmployeeCode || 'UNASSIGNED',
    sellerName: row.sellerName || null,
  };
}

function toOperationsOverviewDto({
  orderItemsByStatus = {},
  productionByStatus = {},
  productionBlockers = {},
  vendorSubmissionsByStatus = {},
  shipmentsByStatus = {},
} = {}) {
  return { orderItemsByStatus, productionByStatus, productionBlockers, vendorSubmissionsByStatus, shipmentsByStatus };
}

module.exports = {
  toAdsChannelPerformanceDto,
  toAdsDailyDto,
  toAdsSellerAttributionDto,
  toAdsSellerDailyDto,
  toBuyerInsightsDto,
  toFinanceBySellerDto,
  toFinanceCoverageDto,
  toFinanceSellerDailyDto,
  toFinanceByTeamDto,
  toFinanceDailyDto,
  toFinanceDailyProfitDto,
  toFinanceOrderProfitabilityDto,
  toOperationsOverviewDto,
  toVendorPerformanceDto,
};
