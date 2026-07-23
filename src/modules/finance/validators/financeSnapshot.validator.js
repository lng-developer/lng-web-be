const Joi = require('joi');
const {
  financeCostStatuses,
  financeSnapshotStatuses,
} = require('../constants/finance.constants');

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

const listSnapshotsQuerySchema = Joi.object({
  orderId: objectId,
  externalOrderId: Joi.string().trim().max(255),
  orderItemId: objectId,
  shopId: objectId,
  salesChannelCode: Joi.string().trim().uppercase(),
  marketplaceCode: Joi.string().trim().uppercase(),
  snapshotStatus: Joi.string().trim().uppercase().valid(...Object.values(financeSnapshotStatuses)),
  costStatus: Joi.string().trim().uppercase().valid(...Object.values(financeCostStatuses)),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const orderIdParamsSchema = Joi.object({
  orderId: objectId.required(),
});

const financeImportContextSchema = Joi.object({
  shopId: objectId.required(),
  salesChannelCode: Joi.string().trim().uppercase().required(),
  marketplaceCode: Joi.string().trim().uppercase().required(),
  sourceRef: Joi.string().trim().max(255).default('finance-import'),
  dryRun: Joi.boolean().default(true),
});

const importBatchParamsSchema = Joi.object({
  batchId: objectId.required(),
});

const listImportBatchesQuerySchema = Joi.object({
  sourceType: Joi.string().trim().uppercase().valid('ADS', 'SETTLEMENTS', 'TRANSACTIONS'),
  shopId: objectId,
  salesChannelCode: Joi.string().trim().uppercase(),
  marketplaceCode: Joi.string().trim().uppercase(),
  status: Joi.string().trim().uppercase().valid('PROCESSING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED'),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const importedDataParamsSchema = Joi.object({
  sourceType: Joi.string().trim().lowercase().valid('ads', 'settlements', 'transactions').required(),
});

const listImportedDataQuerySchema = Joi.object({
  shopId: objectId,
  salesChannelCode: Joi.string().trim().uppercase(),
  marketplaceCode: Joi.string().trim().uppercase(),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

module.exports = {
  financeImportContextSchema,
  importBatchParamsSchema,
  importedDataParamsSchema,
  listImportBatchesQuerySchema,
  listImportedDataQuerySchema,
  listSnapshotsQuerySchema,
  orderIdParamsSchema,
  validate,
};
