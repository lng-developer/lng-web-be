const externalOrderImportJobStatuses = Object.freeze({
  PENDING: 'PENDING',
  PARSING: 'PARSING',
  IMPORTING: 'IMPORTING',
  COMPLETED: 'COMPLETED',
  PARTIAL_FAILED: 'PARTIAL_FAILED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const externalOrderRawRecordNormalizeStatuses = Object.freeze({
  PENDING: 'PENDING',
  NORMALIZED: 'NORMALIZED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

const externalOrderRawRecordImportStatuses = Object.freeze({
  PENDING: 'PENDING',
  IMPORTED: 'IMPORTED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

const externalOrderPostImportStatuses = Object.freeze({
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

module.exports = {
  externalOrderImportJobStatuses,
  externalOrderRawRecordNormalizeStatuses,
  externalOrderRawRecordImportStatuses,
  externalOrderPostImportStatuses,
};
