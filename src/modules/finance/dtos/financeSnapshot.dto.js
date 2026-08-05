function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toFinanceSnapshotDto(snapshot) {
  if (!snapshot) return null;
  return {
    id: toId(snapshot._id || snapshot.id),
    orderId: toId(snapshot.orderId),
    externalOrderId: snapshot.externalOrderId || null,
    orderItemId: toId(snapshot.orderItemId),
    shopId: toId(snapshot.shopId),
    salesChannelCode: snapshot.salesChannelCode || null,
    marketplaceCode: snapshot.marketplaceCode || null,
    fulfillmentPlanId: toId(snapshot.fulfillmentPlanId),
    vendorProductId: toId(snapshot.vendorProductId),
    vendorCostCenterId: toId(snapshot.vendorCostCenterId),
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
      refundAmount: snapshot.refundAmount || 0,
      customerPaidAmount: snapshot.customerPaidAmount || 0,
      currency: snapshot.currency || null,
    },
    cost: {
      baseCostAmount: snapshot.baseCostAmount ?? null,
      totalCostAmount: snapshot.totalCostAmount ?? null,
      costLines: snapshot.costLines || [],
      costStatus: snapshot.costStatus || null,
      missingCostReason: snapshot.missingCostReason || null,
    },
    margin: {
      grossProfitAmount: snapshot.grossProfitAmount ?? null,
      grossMarginBps: snapshot.grossMarginBps ?? null,
    },
    orderPnl: snapshot.orderPnl || null,
    snapshotStatus: snapshot.snapshotStatus,
    calculatedAt: snapshot.calculatedAt,
    calculationHistory: (snapshot.calculationHistory || []).map((entry) => ({
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

function toOrderFinanceSummaryDto(orderId, snapshots = []) {
  const totals = snapshots.reduce((acc, snapshot) => {
    acc.customerPaidAmount += snapshot.customerPaidAmount || 0;
    if (snapshot.totalCostAmount !== null && snapshot.totalCostAmount !== undefined) {
      acc.totalCostAmount += snapshot.totalCostAmount;
    } else {
      acc.missingCostCount += 1;
    }
    if (snapshot.baseCostAmount !== null && snapshot.baseCostAmount !== undefined) {
      acc.baseCostAmount += snapshot.baseCostAmount;
    }
    if (snapshot.grossProfitAmount !== null && snapshot.grossProfitAmount !== undefined) {
      acc.grossProfitAmount += snapshot.grossProfitAmount;
    }
    return acc;
  }, {
    customerPaidAmount: 0,
    baseCostAmount: 0,
    totalCostAmount: 0,
    grossProfitAmount: 0,
    missingCostCount: 0,
  });

  const currency = snapshots.find((snapshot) => snapshot.currency)?.currency || null;
  const grossProfitAmount = snapshots.length && totals.missingCostCount === 0 ? totals.grossProfitAmount : null;

  return {
    orderId: toId(orderId),
    itemCount: snapshots.length,
    currency,
    customerPaidAmount: totals.customerPaidAmount,
    baseCostAmount: snapshots.length ? totals.baseCostAmount : null,
    totalCostAmount: snapshots.length && totals.missingCostCount === 0 ? totals.totalCostAmount : null,
    grossProfitAmount,
    grossMarginBps: grossProfitAmount !== null && totals.customerPaidAmount > 0
      ? Math.round((grossProfitAmount / totals.customerPaidAmount) * 10000)
      : null,
    missingCostCount: totals.missingCostCount,
    snapshots: snapshots.map(toFinanceSnapshotDto),
  };
}

module.exports = {
  toFinanceSnapshotDto,
  toId,
  toOrderFinanceSummaryDto,
  toPaginatedResponse,
};
