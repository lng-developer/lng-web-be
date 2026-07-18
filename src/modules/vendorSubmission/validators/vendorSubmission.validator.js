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
  id: objectId,
  status: Joi.string().trim().uppercase().valid(...Object.values(vendorSubmissionStatuses)),
  productionTaskId: objectId,
  orderId: objectId,
  orderItemId: objectId,
  shopId: objectId,
  vendorId: objectId,
  externalOrderId: Joi.string().trim().max(160),
  vendorExternalOrderId: Joi.string().trim().max(160),
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const summaryQuerySchema = Joi.object({
  id: objectId,
  status: Joi.string().trim().uppercase().valid(...Object.values(vendorSubmissionStatuses)),
  shopId: objectId,
  vendorId: objectId,
  externalOrderId: Joi.string().trim().max(160),
  vendorExternalOrderId: Joi.string().trim().max(160),
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
});

const markFailedSchema = Joi.object({
  failureReason: Joi.string().trim().min(1).max(1000).required(),
});

const cancelSchema = Joi.object({
  cancelReason: Joi.string().trim().max(1000).allow(null, ''),
});

const retrySchema = Joi.object({
  reason: Joi.string().trim().max(1000).allow(null, ''),
});

const submitToVendorSchema = Joi.object({
  provider: Joi.string().trim().uppercase().valid('MERCHIZE', 'PRINTWAY', 'LENFUL').required(),
  dryRun: Joi.boolean().default(true),
});

const recheckReadyProductionTasksSchema = Joi.object({
  shopId: objectId,
  limit: Joi.number().integer().min(1).max(100),
});

module.exports = {
  cancelSchema,
  listSubmissionsQuerySchema,
  markFailedSchema,
  recheckReadyProductionTasksSchema,
  retrySchema,
  summaryQuerySchema,
  submitToVendorSchema,
  validate,
};
