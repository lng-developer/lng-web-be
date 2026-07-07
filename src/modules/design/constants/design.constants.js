const designPermissions = Object.freeze({
  READ: 'DESIGN:READ',
  WRITE: 'DESIGN:WRITE',
});

const designTaskTypes = Object.freeze({
  PSD_TEMPLATE: 'PSD_TEMPLATE',
  MOCKUP: 'MOCKUP',
  PNG_ASSET: 'PNG_ASSET',
  IDEA: 'IDEA',
});

const designTaskStatuses = Object.freeze({
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});

const activeDesignTaskStatuses = Object.freeze([
  designTaskStatuses.OPEN,
  designTaskStatuses.ASSIGNED,
  designTaskStatuses.IN_PROGRESS,
  designTaskStatuses.SUBMITTED,
  designTaskStatuses.REJECTED,
]);

module.exports = {
  activeDesignTaskStatuses,
  designPermissions,
  designTaskStatuses,
  designTaskTypes,
};
