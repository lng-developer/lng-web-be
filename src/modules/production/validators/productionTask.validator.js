const Joi = require('joi');
const {
  productionBlockers,
  productionQcStatuses,
  productionScaleStatuses,
  productionTaskStatuses,
} = require('../constants/production.constants');

const objectId = Joi.string().hex().length(24);
const allowedTaskSortFields = new Set([
  'createdAt',
  'updatedAt',
  'assignedAt',
  'readyAt',
  'sentToVendorAt',
  'status',
  'scaleStatus',
  'qcStatus',
]);

function validateTaskSort(value, helpers) {
  if (!value) return value;
  const invalid = String(value).split(',')
    .map((field) => field.trim().replace(/^-/, ''))
    .find((field) => !allowedTaskSortFields.has(field));
  if (invalid) return helpers.error('any.invalid', { message: `Unsupported sort field: ${invalid}` });
  return value;
}

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (!result.error) return { value: result.value };

  return {
    value: result.value,
    details: result.error.details.map((detail) => ({
      message: detail.message,
      path: detail.path,
      type: detail.type,
    })),
  };
}

const orderItemParamSchema = Joi.object({
  orderItemId: objectId.required(),
});

const listTasksQuerySchema = Joi.object({
  view: Joi.string().trim().uppercase().valid('SCALE', 'QC'),
  status: Joi.string().trim().uppercase().valid(...Object.values(productionTaskStatuses)),
  scaleStatus: Joi.string().trim().uppercase().valid(...Object.values(productionScaleStatuses)),
  qcStatus: Joi.string().trim().uppercase().valid(...Object.values(productionQcStatuses)),
  csStatus: Joi.string().trim().uppercase().valid('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'DONE'),
  salesChannelCode: Joi.string().trim().uppercase().valid('AMAZON', 'ETSY'),
  psdReadyOnly: Joi.boolean(),
  scaleDifficultyLevel: Joi.string().trim().uppercase().valid('NORMAL', 'HARD', 'SPECIAL'),
  blocker: Joi.string().trim().uppercase().valid(...Object.values(productionBlockers)),
  readyForScale: Joi.boolean(),
  designAssignmentStatus: Joi.string().trim().uppercase().valid('UNASSIGNED', 'ASSIGNED', 'OUTPUT_UPLOADED'),
  sellerCode: Joi.string().trim().uppercase().max(40),
  tab: Joi.string().trim().uppercase().valid('ADDRESS_INVALID', 'FAILED'),
  search: Joi.string().trim().max(80),
  assignedDesignUserId: objectId,
  scaleBy: objectId,
  qcBy: objectId,
  csAssigneeId: objectId,
  unassigned: Joi.boolean(),
  csUnassigned: Joi.boolean(),
  shopId: objectId,
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  assignedAtFrom: Joi.date().iso(),
  assignedAtTo: Joi.date().iso(),
  readyAtFrom: Joi.date().iso(),
  readyAtTo: Joi.date().iso(),
  sort: Joi.string().trim().max(300).custom(validateTaskSort),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
}).custom((value, helpers) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    return helpers.error('any.invalid', { message: 'dateFrom must be less than or equal to dateTo' });
  }
  if (value.assignedAtFrom && value.assignedAtTo && value.assignedAtFrom > value.assignedAtTo) {
    return helpers.error('any.invalid', { message: 'assignedAtFrom must be less than or equal to assignedAtTo' });
  }
  if (value.readyAtFrom && value.readyAtTo && value.readyAtFrom > value.readyAtTo) {
    return helpers.error('any.invalid', { message: 'readyAtFrom must be less than or equal to readyAtTo' });
  }
  return value;
});

const taskParamSchema = Joi.object({
  taskId: objectId.required(),
});

const fileCheckParamSchema = Joi.object({
  taskId: objectId.required(),
  fileCheckId: objectId.required(),
});

const scaledOutputSchema = Joi.object({
  mediaAssetId: objectId.required(),
});

const manualFileCheckSchema = Joi.object({
  slotKey: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_:-]{1,80}$/).required(),
  slotLabel: Joi.string().trim().max(120).allow('', null),
  sourceType: Joi.string().trim().uppercase().valid('CUSTOMER_IMAGE', 'PSD_TEMPLATE').default('CUSTOMER_IMAGE'),
  inputAssetId: objectId.allow(null, ''),
});

const assignDesignTaskSchema = Joi.object({
  assignedDesignUserId: objectId.required(),
  designNote: Joi.string().trim().allow('', null),
});

const assignCsTaskSchema = Joi.object({
  csAssigneeId: objectId.allow(null, ''),
  csNote: Joi.string().trim().allow('', null),
});

const bulkAssignDesignTasksSchema = Joi.object({
  taskIds: Joi.array().items(objectId.required()).min(1).max(100).required(),
  assignedDesignUserId: objectId.required(),
  designNote: Joi.string().trim().allow('', null),
});

const bulkPushVendorSchema = Joi.object({
  taskIds: Joi.array().items(objectId.required()).min(1).max(100).required(),
  vendorSubmissionIdsByTaskId: Joi.object()
    .pattern(Joi.string().hex().length(24), objectId.allow(null))
    .default({}),
});

const scaleAssigneesQuerySchema = Joi.object({
  search: Joi.string().trim().max(80),
  limit: Joi.number().integer().min(1).max(100),
});

const csAssigneesQuerySchema = scaleAssigneesQuerySchema;

const recheckPsdBlockedSchema = Joi.object({
  shopId: objectId,
  limit: Joi.number().integer().min(1).default(50).custom((value) => Math.min(value, 100)),
});

const designNoteSchema = Joi.object({
  designNote: Joi.string().trim().allow('', null).required(),
});

const csNoteSchema = Joi.object({
  csNote: Joi.string().trim().allow('', null).required(),
});

const csStatusSchema = Joi.object({
  csStatus: Joi.string().trim().uppercase().valid('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'DONE').required(),
});

const fileDecisionSchema = Joi.object({
  fileCheckId: objectId.required(),
  decision: Joi.string().trim().uppercase().valid('PASSED', 'REJECTED').required(),
  note: Joi.string().trim().allow('', null),
}).custom((value, helpers) => (
  value.decision === 'REJECTED' && !value.note
    ? helpers.error('any.invalid', { message: 'note is required when rejecting a file' })
    : value
));

const qcSchema = Joi.object({
  decision: Joi.string().trim().uppercase().valid('PASSED', 'REJECTED'),
  note: Joi.string().trim().allow('', null),
  fileDecisions: Joi.array().items(fileDecisionSchema).min(1),
}).xor('decision', 'fileDecisions');

const sentToVendorSchema = Joi.object({
  vendorSubmissionId: objectId.allow(null),
});

module.exports = {
  assignDesignTaskSchema,
  assignCsTaskSchema,
  bulkAssignDesignTasksSchema,
  bulkPushVendorSchema,
  csAssigneesQuerySchema,
  csNoteSchema,
  csStatusSchema,
  designNoteSchema,
  fileCheckParamSchema,
  listTasksQuerySchema,
  manualFileCheckSchema,
  orderItemParamSchema,
  qcSchema,
  recheckPsdBlockedSchema,
  scaleAssigneesQuerySchema,
  scaledOutputSchema,
  sentToVendorSchema,
  taskParamSchema,
  validate,
};
