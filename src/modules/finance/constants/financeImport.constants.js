const financeImportStatuses = Object.freeze({
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PARTIAL_FAILED: 'PARTIAL_FAILED',
  FAILED: 'FAILED',
});

const financeRecalculationStatuses = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PARTIAL_FAILED: 'PARTIAL_FAILED',
});

module.exports = { financeImportStatuses, financeRecalculationStatuses };

