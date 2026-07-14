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
    grossProfitAmount: numberValue(row.grossProfitAmount),
    grossMarginBps: row.grossMarginBps === null || row.grossMarginBps === undefined
      ? null
      : numberValue(row.grossMarginBps),
    missingCostCount: numberValue(row.missingCostCount),
    currency: row.currency || null,
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
    grossProfitAmount: numberValue(row.grossProfitAmount),
    grossMarginBps: row.grossMarginBps === null || row.grossMarginBps === undefined
      ? null
      : numberValue(row.grossMarginBps),
    missingCostCount: numberValue(row.missingCostCount),
    currency: row.currency || null,
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
    grossProfitAmount: numberValue(row.grossProfitAmount),
    grossMarginBps: row.grossMarginBps === null || row.grossMarginBps === undefined
      ? null
      : numberValue(row.grossMarginBps),
    missingCostCount: numberValue(row.missingCostCount),
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
    successRateBps: row.successRateBps === null || row.successRateBps === undefined
      ? null
      : numberValue(row.successRateBps),
    avgProcessingHours: row.avgProcessingHours === null || row.avgProcessingHours === undefined
      ? null
      : Number(row.avgProcessingHours),
  };
}

function toOperationsOverviewDto({
  orderItemsByStatus = {},
  productionByStatus = {},
  productionBlockers = {},
  vendorSubmissionsByStatus = {},
  shipmentsByStatus = {},
} = {}) {
  return {
    orderItemsByStatus,
    productionByStatus,
    productionBlockers,
    vendorSubmissionsByStatus,
    shipmentsByStatus,
  };
}

module.exports = {
  toFinanceBySellerDto,
  toFinanceByTeamDto,
  toFinanceDailyDto,
  toOperationsOverviewDto,
  toVendorPerformanceDto,
};
