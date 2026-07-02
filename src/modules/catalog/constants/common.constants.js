const recordStatuses = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

const listingQcStatuses = Object.freeze({
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

const setupStatuses = Object.freeze({
  MISSING: 'MISSING',
  PRESENT: 'PRESENT',
});

module.exports = {
  listingQcStatuses,
  recordStatuses,
  setupStatuses,
};
