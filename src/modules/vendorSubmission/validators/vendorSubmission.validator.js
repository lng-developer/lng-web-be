const Joi = require('joi');
const { vendorSubmissionStatuses } = require('../constants/vendorSubmission.constants');

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

const listSubmissionsQuerySchema = Joi.object({
  status: Joi.string().trim().uppercase().valid(...Object.values(vendorSubmissionStatuses)),
  productionTaskId: objectId,
  orderId: objectId,
  orderItemId: objectId,
  shopId: objectId,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const markFailedSchema = Joi.object({
  failureReason: Joi.string().trim().min(1).max(1000).required(),
});

const cancelSchema = Joi.object({
  cancelReason: Joi.string().trim().max(1000).allow(null, ''),
});

module.exports = {
  cancelSchema,
  listSubmissionsQuerySchema,
  markFailedSchema,
  validate,
};
