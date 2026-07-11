const Joi = require('joi');
const {
  designTaskOutputTypes,
  designTaskStatuses,
  designTaskTypes,
} = require('../constants/design.constants');

const objectId = Joi.string().hex().length(24);

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

const listTasksQuerySchema = Joi.object({
  status: Joi.string().trim().uppercase().valid(...Object.values(designTaskStatuses)),
  taskType: Joi.string().trim().uppercase().valid(...Object.values(designTaskTypes)),
  listingId: objectId,
  shopId: objectId,
  assignedDesignerId: objectId,
  unassigned: Joi.boolean(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const workloadQuerySchema = Joi.object({
  status: Joi.string().trim().uppercase().valid(...Object.values(designTaskStatuses)),
  taskType: Joi.string().trim().uppercase().valid(...Object.values(designTaskTypes)),
  shopId: objectId,
  assignedDesignerId: objectId,
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
});

const createTaskSchema = Joi.object({
  listingId: objectId.required(),
  targetListingId: objectId,
  sourceListingId: objectId,
  sourceInternalTemplateId: objectId,
  taskType: Joi.string().trim().uppercase().valid(...Object.values(designTaskTypes)).required(),
  brief: Joi.string().trim().max(2000).allow(null, ''),
  referenceAssetIds: Joi.array().items(objectId).unique().default([]),
  expectedOutputs: Joi.array()
    .items(Joi.string().trim().uppercase().valid(...Object.values(designTaskOutputTypes)))
    .unique()
    .default([]),
  note: Joi.string().trim().max(1000).allow(null, ''),
}).custom((value, helpers) => {
  if (value.taskType === designTaskTypes.IDEA && !String(value.brief || '').trim()) {
    return helpers.error('any.custom', { message: 'brief is required for IDEA task' });
  }
  if (
    value.taskType === designTaskTypes.CLONE
    && !value.sourceListingId
    && !value.sourceInternalTemplateId
  ) {
    return helpers.error('any.custom', {
      message: 'sourceListingId or sourceInternalTemplateId is required for CLONE task',
    });
  }
  return value;
});

const assignTaskSchema = Joi.object({
  assignedDesignerId: objectId.required(),
  note: Joi.string().trim().max(1000).allow(null, ''),
});

const noteOnlySchema = Joi.object({
  note: Joi.string().trim().max(1000).allow(null, ''),
});

const submitTaskSchema = Joi.object({
  submittedAssetIds: Joi.array().items(objectId).min(1).required(),
  note: Joi.string().trim().max(1000).allow(null, ''),
});

const approveTaskSchema = Joi.object({
  approvedAssetId: objectId.required(),
});

const rejectTaskSchema = Joi.object({
  rejectReason: Joi.string().trim().min(1).max(1000).required(),
});

const cancelTaskSchema = Joi.object({
  cancelReason: Joi.string().trim().max(1000).allow(null, ''),
});

module.exports = {
  approveTaskSchema,
  assignTaskSchema,
  cancelTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  noteOnlySchema,
  rejectTaskSchema,
  submitTaskSchema,
  validate,
  workloadQuerySchema,
};
