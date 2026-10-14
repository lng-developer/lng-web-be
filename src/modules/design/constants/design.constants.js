const designPermissions = Object.freeze({
  READ: 'DESIGN:READ',
  WRITE: 'DESIGN:WRITE',
  WORK: 'DESIGN:WORK',
  REVIEW: 'DESIGN:REVIEW',
  PSD_REQUEST: 'DESIGN:PSD_REQUEST',
});


const designTaskTypes = Object.freeze({
  PSD_TEMPLATE: 'PSD_TEMPLATE',
  MOCKUP: 'MOCKUP',
  PNG_ASSET: 'PNG_ASSET',
  IDEA: 'IDEA',
  CLONE: 'CLONE',
});

const designTaskOutputTypes = Object.freeze({
  PSD_TEMPLATE: 'PSD_TEMPLATE',
  MOCKUP: 'MOCKUP',
  PNG_ASSET: 'PNG_ASSET',
  IDEA: 'IDEA',
});

const designTaskStatuses = Object.freeze({
  REQUESTED: 'REQUESTED',
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});

const designTaskSubmissionStatuses = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REMOVED: 'REMOVED',
});

const designTaskPriorities = Object.freeze({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
});

const activeDesignTaskStatuses = Object.freeze([
  designTaskStatuses.REQUESTED,
  designTaskStatuses.OPEN,
  designTaskStatuses.ASSIGNED,
  designTaskStatuses.IN_PROGRESS,
  designTaskStatuses.SUBMITTED,
  designTaskStatuses.REJECTED,
]);

const designScoreLevels = Object.freeze({
  BASIC: 'BASIC',
  STANDARD: 'STANDARD',
  HARD: 'HARD',
  BONUS: 'BONUS',
});

const designScoreStatuses = Object.freeze({
  ACTIVE: 'ACTIVE',
  VOIDED: 'VOIDED',
});

module.exports = {
  activeDesignTaskStatuses,
  designScoreLevels,
  designScoreStatuses,
  designPermissions,
  designTaskOutputTypes,
  designTaskPriorities,
  designTaskSubmissionStatuses,
  designTaskStatuses,
  designTaskTypes,
};
