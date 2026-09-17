function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toCashFlowItemDto(row = {}) {
  return {
    id: toId(row._id || row.id),
    occurredAt: row.occurredAt || null,
    sourceKind: row.sourceKind,
    amount: row.amount || 0,
    currency: row.currency || 'USD',
    reconciliationStatus: row.reconciliationStatus,
    orderId: toId(row.orderId),
    orderItemId: toId(row.orderItemId),
    externalOrderId: row.externalOrderId || null,
    settlementId: row.settlementId || null,
    settlementRecordId: toId(row.settlementRecordId),
    sourceRef: row.sourceRef || null,
    importBatchId: toId(row.importBatchId),
    reason: row.reason || null,
  };
}

function toCashFlowDto(result = {}) {
  return {
    summaryByCurrency: (result.summaryByCurrency || []).map((summary) => ({
      currency: summary.currency || 'USD',
      transactionNetAmount: summary.transactionNetAmount || 0,
      feeAmount: summary.feeAmount || 0,
      settlementPayoutAmount: summary.settlementPayoutAmount || 0,
      unlinkedCount: summary.unlinkedCount || 0,
      payoutVarianceCount: summary.payoutVarianceCount || 0,
    })),
    importErrorCount: result.importErrorCount || 0,
    items: (result.items || []).map(toCashFlowItemDto),
    pagination: result.pagination || { total: 0, page: 1, limit: 20 },
  };
}

module.exports = { toCashFlowDto, toCashFlowItemDto };
