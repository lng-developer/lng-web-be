function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toSettlementLedgerDto(row) {
  if (!row) return null;
  const { _id, __v, rawReference, ...data } = row;
  return { id: toId(_id || row.id), ...data };
}

function settlementLedgerSummary(settlement = {}, ledgerSummary = {}) {
  const payoutAmount = settlement.totalAmount ?? settlement.netSettlementAmount ?? 0;
  const ledgerNetAmount = ledgerSummary.netAmount || 0;
  const lineCount = ledgerSummary.lineCount || 0;
  const linkedCount = ledgerSummary.linkedCount || 0;
  return {
    ...ledgerSummary,
    payoutAmount,
    ledgerNetAmount,
    cashVarianceAmount: payoutAmount - ledgerNetAmount,
    linkCoverageBps: lineCount ? Math.round((linkedCount / lineCount) * 10000) : null,
  };
}

function toSettlementDto(row) {
  if (!row) return null;
  const { _id, __v, rawReference, ledgerSummary, ...data } = row;
  return {
    id: toId(_id || row.id),
    ...data,
    reconciliation: {
      status: data.reconciliationStatus || 'OPEN',
      note: data.reconciliationNote || null,
      reconciledAt: data.reconciledAt || null,
      reconciledByAccountId: toId(data.reconciledByAccountId),
    },
    ledgerSummary: settlementLedgerSummary(data, ledgerSummary || {
      inflowAmount: 0,
      outflowAmount: 0,
      netAmount: 0,
      lineCount: 0,
      linkedCount: 0,
      unlinkedCount: 0,
    }),
  };
}

function toSettlementListDto(result = {}) {
  return {
    items: (result.items || []).map(toSettlementDto),
    total: result.total || 0,
    page: result.page || 1,
    limit: result.limit || 20,
    summaryByCurrency: result.summaryByCurrency || [],
  };
}

function toSettlementDetailDto(result = {}) {
  const ledger = result.ledger || {};
  return {
    settlement: toSettlementDto(result.settlement),
    ledger: {
      items: (ledger.items || []).map(toSettlementLedgerDto),
      pagination: ledger.pagination || {
        total: ledger.total || 0,
        page: ledger.page || 1,
        limit: ledger.limit || 20,
      },
      summary: ledger.summary || {
        inflowAmount: 0,
        outflowAmount: 0,
        netAmount: 0,
        lineCount: 0,
        linkedCount: 0,
        unlinkedCount: 0,
      },
    },
  };
}

module.exports = {
  settlementLedgerSummary,
  toSettlementDetailDto,
  toSettlementListDto,
  toSettlementDto,
  toSettlementLedgerDto,
};
