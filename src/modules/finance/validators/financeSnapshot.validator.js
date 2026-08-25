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
  sellerEmployeeCode: Joi.string().trim().uppercase().max(80),
  teamId: objectId,
  departmentId: objectId,
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const exportSnapshotsQuerySchema = listSnapshotsQuerySchema.keys({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(5000).default(5000),
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

const adsShopMappingSchema = Joi.object({
  advertiserAccountId: Joi.string().trim().max(255).required(),
  matchType: Joi.string().valid('CAMPAIGN', 'PORTFOLIO').required(),
  externalId: Joi.string().trim().max(255).required(),
  shopId: objectId.required(),
  salesChannelCode: Joi.string().trim().uppercase().default('AMAZON'),
  marketplaceCode: Joi.string().trim().uppercase().default('US'),
  active: Joi.boolean().default(true),
});

const listAdsShopMappingsQuerySchema = Joi.object({
  advertiserAccountId: Joi.string().trim().max(255),
  shopId: objectId,
  matchType: Joi.string().valid('CAMPAIGN', 'PORTFOLIO'),
  active: Joi.boolean(),
});

const listAdsUnassignedRowsQuerySchema = Joi.object({
  status: Joi.string().valid('PENDING', 'RESOLVED').default('PENDING'),
  advertiserAccountId: Joi.string().trim().max(255),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
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
  adsShopMappingSchema,
  importBatchParamsSchema,
  importedDataParamsSchema,
  listImportBatchesQuerySchema,
  listAdsShopMappingsQuerySchema,
  listAdsUnassignedRowsQuerySchema,
  listImportedDataQuerySchema,
  exportSnapshotsQuerySchema,
  listSnapshotsQuerySchema,
  orderIdParamsSchema,
  validate,
};
