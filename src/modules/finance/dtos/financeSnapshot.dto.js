const { readSnapshotFinancials } = require('../services/financeCalculation.service');
function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toFinanceSnapshotDto(snapshot) {
  if (!snapshot) return null;
  const canonical = readSnapshotFinancials(snapshot);
  return {
    ...canonical,
    id: toId(snapshot._id || snapshot.id),
    missingSnapshot: Boolean(snapshot.missingSnapshot),
    orderId: toId(snapshot.orderId),
    externalOrderId: snapshot.externalOrderId || null,
    orderItemId: toId(snapshot.orderItemId),
    productImageUrl: snapshot.productImageUrl || null,
    productTitle: snapshot.productTitle || null,
    productSku: snapshot.productSku || null,
    orderedAt: snapshot.orderedAt || null,
    shopId: toId(snapshot.shopId),
    salesChannelCode: snapshot.salesChannelCode || null,
    marketplaceCode: snapshot.marketplaceCode || null,
    fulfillmentPlanId: toId(snapshot.fulfillmentPlanId),
    vendorProductId: toId(snapshot.vendorProductId),
    vendorCostCenterId: toId(snapshot.vendorCostCenterId),
    costRate: {
      version: snapshot.costRateVersion ?? null,
      effectiveFrom: snapshot.costRateEffectiveFrom || null,
    },
    shipmentId: toId(snapshot.shipmentId),
    seller: {
      employeeCode: snapshot.sellerEmployeeCode || null,
      accountId: toId(snapshot.sellerAccountId),
      name: snapshot.sellerName || null,
    },
    team: {
      id: toId(snapshot.teamId),
      name: snapshot.teamName || null,
      code: snapshot.teamCode || null,
    },
    department: {
      id: toId(snapshot.departmentId),
      name: snapshot.departmentName || null,
      code: snapshot.departmentCode || null,
    },
    revenue: {
      itemPriceAmount: snapshot.itemPriceAmount || 0,
      taxAmount: snapshot.taxAmount || 0,
      shippingAmount: snapshot.shippingAmount || 0,
      giftWrapAmount: snapshot.giftWrapAmount || 0,
      discountAmount: snapshot.discountAmount || 0,
      feeAmount: snapshot.feeAmount || 0,
      feeSource: snapshot.feeSource || null,
      feeConfidence: snapshot.feeConfidence || null,
      refundAmount: snapshot.refundAmount || 0,
      customerPaidAmount: snapshot.customerPaidAmount || 0,
      netRevenueAmount: snapshot.netRevenueAmount ?? Math.max(
        (snapshot.customerPaidAmount || 0) - (snapshot.refundAmount || 0),
        0,
      ),
      orderItemStatus: snapshot.orderItemStatus || null,
      financialStatus: snapshot.financialStatus || 'ACTIVE',
      currency: snapshot.currency || null,
    },
    cost: {
      estimatedCostCurrency: snapshot.estimatedCostCurrency || null,
      baseCostAmount: snapshot.baseCostAmount ?? null,
      totalCostAmount: canonical.effectiveFulfillmentCostAmount,
      estimatedFulfillmentCostAmount: canonical.estimatedFulfillmentCostAmount,
      costLines: snapshot.costLines || [],
      costStatus: snapshot.costStatus || null,
      costBasis: snapshot.costBasis || null,
      missingCostReason: snapshot.missingCostReason || null,
    },
    actualVendorCost: {
      baseCostAmount: snapshot.actualVendorBaseCostAmount ?? null,
      shippingAmount: snapshot.actualVendorShippingAmount ?? null,
      taxAmount: snapshot.actualVendorTaxAmount ?? null,
      totalAmount: snapshot.actualVendorTotalAmount ?? null,
      currency: snapshot.actualVendorCurrency || null,
      source: snapshot.actualVendorSource || null,
      capturedAt: snapshot.actualVendorCapturedAt || null,
      allocation: snapshot.actualVendorAllocation || null,
    },
    margin: {
      grossProfitAmount: canonical.profitBeforeAdsAmount,
      grossMarginBps: snapshot.grossMarginBps ?? null,
    },
    orderPnl: snapshot.orderPnl || null,
    snapshotStatus: snapshot.snapshotStatus,
    profitStatus: canonical.profitStatus,
    evidence: {
      sourceReferences: snapshot.sourceReferences || [],
    },
    calculatedAt: snapshot.calculatedAt,
    calculationHistory: (snapshot.calculationHistory || []).map((entry) => ({
      calculationVersion: entry.calculationVersion || 1,
      calculatedAt: entry.calculatedAt,
      snapshotStatus: entry.snapshotStatus,
      costStatus: entry.costStatus,
      missingCostReason: entry.missingCostReason || null,
    })),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function toPaginatedResponse(result = {}) {
  return {
    items: (result.items || []).map(toFinanceSnapshotDto),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

function toOrderFinanceRowDto(row, children) {
  const first = children[0];
  if (!first) return null;
  const same = key => children.every(item => JSON.stringify(item[key]) === JSON.stringify(first[key]));
  const feeConfidence = children.every(item => item.revenue.feeConfidence === 'ACTUAL') ? 'ACTUAL'
    : children.some(item => item.revenue.feeConfidence === 'ESTIMATED') ? 'ESTIMATED' : 'ALLOCATED';
  return {
    ...first, id: `order-${row.orderId}-${row.currency}`, rowType: 'ORDER', orderItemId: null, children,
    productTitle: null, productSku: null,
    seller: same('seller') ? first.seller : { employeeCode: null, name: null },
    team: same('team') ? first.team : { id: null, name: null, code: null },
    department: same('department') ? first.department : { id: null, name: null, code: null },
    revenue: { ...first.revenue, feeConfidence, feeSource: children.every(item => item.revenue.feeSource === first.revenue.feeSource) ? first.revenue.feeSource : null,
      financialStatus: children.every(item => item.revenue.financialStatus === first.revenue.financialStatus) ? first.revenue.financialStatus : null,
      customerPaidAmount: row.revenueAmount, netRevenueAmount: row.netRevenueAmount,
      feeAmount: row.marketplaceFeeAmount, refundAmount: row.refundAmount, discountAmount: row.discountAmount },
    cost: { ...first.cost, totalCostAmount: row.totalCostAmount, baseCostAmount: row.baseCostAmount,
      costStatus: row.missingCostCount ? 'MISSING' : 'PRESENT', costLines: [] },
    margin: { grossProfitAmount: row.profitAmount, grossMarginBps: row.marginBps },
    profitBeforeAdsAmount: row.profitAmount, effectiveFulfillmentCostAmount: row.totalCostAmount,
    estimatedFulfillmentCostAmount: row.estimatedFulfillmentCostAmount,
    costVarianceAmount: row.costVarianceAmount,
    costComponents: [],
    recognizedNetRevenueAmount: children.reduce((sum, item) => sum + item.recognizedNetRevenueAmount, 0),
    actualVendorCost: null, orderPnl: null, evidence: { sourceReferences: [] },
    calculationVersion: row.migrationPendingCount ? 1 : 2,
    profitStatus: children.every(item => item.profitStatus === 'ACTUAL') ? 'ACTUAL' : row.missingCostCount ? 'INCOMPLETE_COST' : 'ESTIMATED',
    costSource: children.every(item => item.costSource === 'ACTUAL') ? 'ACTUAL' : row.missingCostCount ? 'MISSING' : 'ESTIMATED',
  };
}

function toOrderFinanceSummaryDto(orderId, snapshots = [], includeGroups = true) {
  const totals = snapshots.reduce((acc, source) => {
    const canonical = readSnapshotFinancials(source);
    const snapshot = { ...source, totalCostAmount: canonical.effectiveFulfillmentCostAmount, grossProfitAmount: canonical.profitBeforeAdsAmount };
    acc.customerPaidAmount += snapshot.customerPaidAmount || 0;
    acc.recognizedNetRevenueAmount += canonical.recognizedNetRevenueAmount || 0;
    acc.marketplaceFeeAmount += snapshot.feeAmount || 0;
    if (snapshot.totalCostAmount !== null && snapshot.totalCostAmount !== undefined) {
      acc.totalCostAmount += snapshot.totalCostAmount;
    } else {
      acc.missingCostCount += 1;
    }
    acc.baseCostAmount += snapshot.calculationVersion === 2
      ? (canonical.costComponents || []).filter(line => line.code === 'VENDOR_BASE').reduce((sum, line) => sum + line.amount, 0)
      : snapshot.baseCostAmount || 0;
    if (snapshot.grossProfitAmount !== null && snapshot.grossProfitAmount !== undefined) {
      acc.grossProfitAmount += snapshot.grossProfitAmount;
    } else acc.missingProfitCount += 1;
    return acc;
  }, {
    customerPaidAmount: 0,
    recognizedNetRevenueAmount: 0,
    marketplaceFeeAmount: 0,
    baseCostAmount: 0,
    totalCostAmount: 0,
    grossProfitAmount: 0,
    missingCostCount: 0,
    missingProfitCount: 0,
  });

  const currencies = [...new Set(snapshots.map(snapshot => snapshot.currency || null))];
  const mixed = currencies.length > 1;
  const currency = mixed ? null : currencies[0] || null;
  const grossProfitAmount = !mixed && snapshots.length && totals.missingCostCount === 0 && totals.missingProfitCount === 0 ? totals.grossProfitAmount : null;

  return {
    orderId: toId(orderId),
    missingSnapshotCount: snapshots.filter(item => item.missingSnapshot).length,
    itemCount: snapshots.length,
    currency,
    customerPaidAmount: mixed ? null : totals.customerPaidAmount,
    recognizedNetRevenueAmount: mixed ? null : totals.recognizedNetRevenueAmount,
    revenueAdjustmentAmount: mixed ? null : totals.customerPaidAmount - totals.recognizedNetRevenueAmount,
    marketplaceFeeAmount: mixed ? null : totals.marketplaceFeeAmount,
    baseCostAmount: !mixed && snapshots.length ? totals.baseCostAmount : null,
    totalCostAmount: !mixed && snapshots.length && totals.missingCostCount === 0 ? totals.totalCostAmount : null,
    grossProfitAmount,
    grossMarginBps: grossProfitAmount !== null && totals.customerPaidAmount > 0
      ? Math.round((grossProfitAmount / totals.customerPaidAmount) * 10000)
      : null,
    missingCostCount: totals.missingCostCount,
    snapshots: snapshots.map(toFinanceSnapshotDto),
    ...(includeGroups ? { summaryByCurrency: currencies.map(value => toOrderFinanceSummaryDto(orderId, snapshots.filter(snapshot => (snapshot.currency || null) === value), false)) } : {}),
  };
}

module.exports = {
  toOrderFinanceRowDto,
  toFinanceSnapshotDto,
  toId,
  toOrderFinanceSummaryDto,
  toPaginatedResponse,
};
