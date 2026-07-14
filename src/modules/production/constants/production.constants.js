const productionTaskStatuses = Object.freeze({
  BLOCKED: 'BLOCKED',
  NEED_SCALE: 'NEED_SCALE',
  QC_PENDING: 'QC_PENDING',
  QC_REJECTED: 'QC_REJECTED',
  READY_TO_SEND_VENDOR: 'READY_TO_SEND_VENDOR',
  SENT_TO_VENDOR: 'SENT_TO_VENDOR',
  CANCELLED: 'CANCELLED',
});

const productionScaleStatuses = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  NEED_SCALE: 'NEED_SCALE',
  SCALED: 'SCALED',
});

const productionQcStatuses = Object.freeze({
  NOT_READY: 'NOT_READY',
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  REJECTED: 'REJECTED',
});

const productionCsStatuses = Object.freeze({
  UNASSIGNED: 'UNASSIGNED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
});

const productionBlockers = Object.freeze({
  MAPPING_NOT_READY: 'MAPPING_NOT_READY',
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  PSD_MISSING: 'PSD_MISSING',
  CUSTOMER_IMAGE_MISSING: 'CUSTOMER_IMAGE_MISSING',
  SCALED_OUTPUT_MISSING: 'SCALED_OUTPUT_MISSING',
  QC_REJECTED: 'QC_REJECTED',
});

const productionSourceTypes = Object.freeze({
  PSD_TEMPLATE: 'PSD_TEMPLATE',
  CUSTOMER_IMAGE: 'CUSTOMER_IMAGE',
});

const productionPermissions = Object.freeze({
  READ: 'PRODUCTION:READ',
  WRITE: 'PRODUCTION:WRITE',
});

module.exports = {
  productionBlockers,
  productionCsStatuses,
  productionPermissions,
  productionQcStatuses,
  productionScaleStatuses,
  productionSourceTypes,
  productionTaskStatuses,
};
