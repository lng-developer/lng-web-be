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

module.exports = {
  financeCostStatuses,
  financePermissions,
  financeSourceTypes,
  financeSnapshotStatuses,
};
