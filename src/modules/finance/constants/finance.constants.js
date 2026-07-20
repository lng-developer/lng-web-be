const financePermissions = Object.freeze({
  READ: 'FINANCE:READ',
  WRITE: 'FINANCE:WRITE',
});

const financeSnapshotStatuses = Object.freeze({
  ESTIMATED: 'ESTIMATED',
  MISSING_COST: 'MISSING_COST',
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

const SELLER_DAILY_OPERATING_COST_AMOUNT = 3000;
const SELLER_OPERATING_COST_TEAM_CODE = 'SALES';

module.exports = {
  financeCostStatuses,
  financePermissions,
  financeSourceTypes,
  financeSnapshotStatuses,
  SELLER_DAILY_OPERATING_COST_AMOUNT,
  SELLER_OPERATING_COST_TEAM_CODE,
};
