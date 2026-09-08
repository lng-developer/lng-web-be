function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toSettlementLedgerDto(row) {
  if (!row) return null;
  const { _id, __v, rawReference, ...data } = row;
  return { id: toId(_id || row.id), ...data };
}

function toSettlementDto(row) {
  if (!row) return null;
  const { _id, __v, rawReference, ledgerSummary, ...data } = row;
  return {
    id: toId(_id || row.id),
    ...data,
    ledgerSummary: ledgerSummary || {
      inflowAmount: 0,
      outflowAmount: 0,
      netAmount: 0,
      lineCount: 0,
      linkedCount: 0,
      unlinkedCount: 0,
    },
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
  toSettlementDetailDto,
  toSettlementListDto,
  toSettlementDto,
  toSettlementLedgerDto,
};
