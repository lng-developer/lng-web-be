const Joi = require('joi');

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
  status: Joi.string().trim().uppercase(),
  scaleStatus: Joi.string().trim().uppercase(),
  qcStatus: Joi.string().trim().uppercase(),
  blocker: Joi.string().trim().uppercase(),
  designAssignmentStatus: Joi.string().trim().uppercase().valid('UNASSIGNED', 'ASSIGNED', 'OUTPUT_UPLOADED'),
  search: Joi.string().trim().max(80),
  assignedDesignUserId: objectId,
  scaleBy: objectId,
  qcBy: objectId,
  unassigned: Joi.boolean(),
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

const assignDesignTaskSchema = Joi.object({
  assignedDesignUserId: objectId.required(),
  designNote: Joi.string().trim().allow('', null),
});

const bulkAssignDesignTasksSchema = Joi.object({
  taskIds: Joi.array().items(objectId.required()).min(1).max(100).required(),
  assignedDesignUserId: objectId.required(),
  designNote: Joi.string().trim().allow('', null),
});

const recheckPsdBlockedSchema = Joi.object({
  shopId: objectId,
  limit: Joi.number().integer().min(1).default(50).custom((value) => Math.min(value, 100)),
});

const designNoteSchema = Joi.object({
  designNote: Joi.string().trim().allow('', null).required(),
});

const qcSchema = Joi.object({
  decision: Joi.string().trim().uppercase().valid('PASSED', 'REJECTED').required(),
  note: Joi.string().trim().allow('', null),
});

const sentToVendorSchema = Joi.object({
  vendorSubmissionId: objectId.allow(null),
});

module.exports = {
  assignDesignTaskSchema,
  bulkAssignDesignTasksSchema,
  designNoteSchema,
  fileCheckParamSchema,
  listTasksQuerySchema,
  orderItemParamSchema,
  qcSchema,
  recheckPsdBlockedSchema,
  scaledOutputSchema,
  sentToVendorSchema,
  taskParamSchema,
  validate,
};
