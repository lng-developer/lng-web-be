const financePermissions = Object.freeze({
  READ: 'FINANCE:READ',
  WRITE: 'FINANCE:WRITE',
});

const financeSnapshotStatuses = Object.freeze({
  ESTIMATED: 'ESTIMATED',
  MISSING_COST: 'MISSING_COST',
});

const financeProfitStatuses = Object.freeze({
  ACTUAL: 'ACTUAL',
  ESTIMATED: 'ESTIMATED',
  INCOMPLETE_COST: 'INCOMPLETE_COST',
});

const financeCostBases = Object.freeze({
  RATE_CARD: 'RATE_CARD',
  VENDOR_INVOICE: 'VENDOR_INVOICE',
  MISSING: 'MISSING',
});

const financeFeeConfidences = Object.freeze({
  ACTUAL: 'ACTUAL',
  ESTIMATED: 'ESTIMATED',
});

const financeCostStatuses = Object.freeze({
  PRESENT: 'PRESENT',
  MISSING: 'MISSING',
});

const financeSourceTypes = Object.freeze({
  MANUAL: 'MANUAL',
  IMPORT: 'IMPORT',
  SYSTEM: 'SYSTEM',
});

const marketplaceFeeSources = Object.freeze({
  ESTIMATED_15_PERCENT: 'ESTIMATED_15_PERCENT',
  ORDER_IMPORT: 'ORDER_IMPORT',
  SETTLEMENT: 'SETTLEMENT',
});

const MARKETPLACE_FEE_ESTIMATE_BPS = 1500;


module.exports = {
  financeCostStatuses,
  financeCostBases,
  financeFeeConfidences,
  financePermissions,
  financeProfitStatuses,
  financeSourceTypes,
  financeSnapshotStatuses,
  marketplaceFeeSources,
  MARKETPLACE_FEE_ESTIMATE_BPS,
};
