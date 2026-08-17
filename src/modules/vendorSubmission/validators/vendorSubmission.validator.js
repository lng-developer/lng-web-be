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
  dateFrom: Joi.string().isoDate(),
  dateTo: Joi.string().isoDate(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const exportSubmissionsQuerySchema = listSubmissionsQuerySchema.keys({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(5000).default(5000),
});

const summaryQuerySchema = Joi.object({
  id: objectId,
  status: Joi.string().trim().uppercase().valid(...Object.values(vendorSubmissionStatuses)),
  shopId: objectId,
  vendorId: objectId,
  externalOrderId: Joi.string().trim().max(160),
  vendorExternalOrderId: Joi.string().trim().max(160),
  dateFrom: Joi.string().isoDate(),
  dateTo: Joi.string().isoDate(),
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
  provider: Joi.string().trim().uppercase().valid('MERCHIZE', 'PRINTWAY', 'LENFUL'),
  dryRun: Joi.boolean().default(true),
});

const reconcileSchema = Joi.object({
  outcome: Joi.string().trim().uppercase().valid('REMOTE_FOUND', 'REMOTE_NOT_FOUND').required(),
  vendorExternalOrderId: Joi.when('outcome', {
    is: 'REMOTE_FOUND',
    then: Joi.string().trim().max(160).required(),
    otherwise: Joi.forbidden(),
  }),
  reason: Joi.string().trim().max(1000).allow(null, ''),
});

const recheckReadyProductionTasksSchema = Joi.object({
  shopId: objectId,
  limit: Joi.number().integer().min(1).max(100),
});

module.exports = {
  cancelSchema,
  exportSubmissionsQuerySchema,
  listSubmissionsQuerySchema,
  markFailedSchema,
  reconcileSchema,
  recheckReadyProductionTasksSchema,
  retrySchema,
  summaryQuerySchema,
  submitToVendorSchema,
  validate,
};
