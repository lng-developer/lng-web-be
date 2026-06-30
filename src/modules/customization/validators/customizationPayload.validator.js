const Joi = require('joi');
const { customizationStatuses } = require('../constants/customizationStatuses');

const supportedSources = ['AMAZON_EXTENSION_REPORT', 'MANUAL_EXCEL'];
const objectIdSchema = Joi.string().hex().length(24);

const paginationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const createPendingPayloadSchema = Joi.object({
  orderItemId: objectIdSchema.required(),
  orderId: objectIdSchema.required(),
  shopId: objectIdSchema.required(),
  source: Joi.string().trim().uppercase().valid(...supportedSources).required(),
  rawRecordId: objectIdSchema,
  rawCustomization: Joi.object().min(1).required(),
  assets: Joi.array().items(Joi.object({
    assetId: objectIdSchema,
    sourceUrl: Joi.string().trim().allow(null),
    type: Joi.string().trim().uppercase().allow(null),
    status: Joi.string().valid(
      customizationStatuses.PENDING,
      customizationStatuses.DOWNLOADED,
      customizationStatuses.FAILED,
    ),
    metadata: Joi.object(),
  })),
});

const payloadIdParamSchema = Joi.object({
  payloadId: objectIdSchema.required(),
});

const orderItemIdParamSchema = Joi.object({
  orderItemId: objectIdSchema.required(),
});

const listPayloadsQuerySchema = paginationQuerySchema.keys({
  shopId: objectIdSchema,
  orderItemId: objectIdSchema,
  status: Joi.string().valid(...Object.values(customizationStatuses)),
});

const needsReviewSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(1000).required(),
});

const failedSchema = Joi.object({
  errorCode: Joi.string().trim().uppercase().min(1).max(120).required(),
  errorMessage: Joi.string().trim().max(1000).allow(null),
});

const parsedSchema = Joi.object({
  parsedData: Joi.object().required(),
});

const downloadAssetsSchema = Joi.object({
  retryFailed: Joi.boolean().truthy('true').falsy('false').default(false),
});

const inspectZipSchema = Joi.object({
  maxEntries: Joi.number().integer().min(1).max(1000).default(50),
  maxTotalUncompressedBytes: Joi.number().integer().min(1).max(1024 * 1024 * 1024).default(50 * 1024 * 1024),
  maxSingleEntryUncompressedBytes: Joi.number().integer().min(1).max(1024 * 1024 * 1024).default(20 * 1024 * 1024),
});

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (!result.error) {
    return { value: result.value, details: null };
  }

  return {
    value: result.value,
    details: result.error.details.map((detail) => ({
      message: detail.message,
      path: detail.path,
      type: detail.type,
    })),
  };
}

module.exports = {
  createPendingPayloadSchema,
  payloadIdParamSchema,
  orderItemIdParamSchema,
  listPayloadsQuerySchema,
  needsReviewSchema,
  failedSchema,
  parsedSchema,
  downloadAssetsSchema,
  inspectZipSchema,
  validate,
};
