const Joi = require('joi');

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
  unassigned: Joi.boolean(),
  shopId: objectId,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
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
  scaledOutputSchema,
  sentToVendorSchema,
  taskParamSchema,
  validate,
};
