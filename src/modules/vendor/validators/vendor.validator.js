const Joi = require('joi');
const {
  recordStatuses,
  vendorFulfillmentTypes,
  vendorIntegrationAuthTypes,
  vendorIntegrationStatuses,
  vendorProviderKeys,
} = require('../constants/vendor.constants');
const { printMethodValues } = require('../../../shared/constants/printMethods');

const objectId = Joi.string().hex().length(24);
const metadata = Joi.object().unknown(true);
const nonNegativeNumber = Joi.number().min(0);
const printMethod = Joi.string().trim().uppercase().valid(...printMethodValues).allow(null);

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

const listVendorsQuerySchema = Joi.object({
  id: objectId,
  code: Joi.string().trim().uppercase().max(80),
  providerKey: Joi.string().trim().uppercase().valid(...Object.values(vendorProviderKeys)),
  fulfillmentType: Joi.string().trim().uppercase().valid(...Object.values(vendorFulfillmentTypes)),
  status: Joi.string().valid(...Object.values(recordStatuses)),
  q: Joi.string().trim().max(160),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const createVendorSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(1).max(80).required(),
  name: Joi.string().trim().min(1).max(160).required(),
  providerKey: Joi.string().trim().uppercase().valid(...Object.values(vendorProviderKeys)).allow(null),
  fulfillmentType: Joi.string().trim().uppercase().valid(...Object.values(vendorFulfillmentTypes)).required(),
  status: Joi.string().valid(...Object.values(recordStatuses)),
  metadata,
});

const updateVendorSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160),
  providerKey: Joi.string().trim().uppercase().valid(...Object.values(vendorProviderKeys)).allow(null),
  fulfillmentType: Joi.string().trim().uppercase().valid(...Object.values(vendorFulfillmentTypes)),
  status: Joi.string().valid(...Object.values(recordStatuses)),
  metadata,
}).min(1);

const updateVendorIntegrationConfigSchema = Joi.object({
  providerKey: Joi.string().trim().uppercase().valid(...Object.values(vendorProviderKeys)).required(),
  baseUrl: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(1000).required(),
  authType: Joi.string().trim().uppercase().valid(...Object.values(vendorIntegrationAuthTypes)).required(),
  accessToken: Joi.string().trim().max(8000).allow(null, ''),
  refreshToken: Joi.string().trim().max(8000).allow(null, ''),
  username: Joi.string().trim().max(320).allow(null, ''),
  password: Joi.string().trim().max(8000).allow(null, ''),
  expiresAt: Joi.date().iso().allow(null),
  status: Joi.string().trim().uppercase().valid(...Object.values(vendorIntegrationStatuses)),
  metadata,
});

const refreshVendorIntegrationCredentialSchema = Joi.object({
  providerKey: Joi.string().trim().uppercase().valid(...Object.values(vendorProviderKeys)).required(),
});

const listVendorProductsQuerySchema = Joi.object({
  vendorId: objectId,
  productTypeGroupId: objectId,
  code: Joi.string().trim().uppercase().max(80),
  externalProductId: Joi.string().trim().max(120),
  status: Joi.string().valid(...Object.values(recordStatuses)),
  q: Joi.string().trim().max(160),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const listVendorMigrationReviewsQuerySchema = Joi.object({
  q: Joi.string().trim().max(160),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const assignVendorMigrationProductTypeGroupSchema = Joi.object({
  legacyProductIds: Joi.array().items(Joi.string().trim().min(1).max(120)).min(1).max(100).unique().required(),
  productTypeGroupId: objectId.required(),
});

const createVendorProductSchema = Joi.object({
  vendorId: objectId.required(),
  productTypeGroupId: objectId.required(),
  code: Joi.string().trim().uppercase().min(1).max(80).required(),
  name: Joi.string().trim().min(1).max(200).required(),
  externalProductId: Joi.string().trim().max(120).allow(null, ''),
  imageUrl: Joi.string().trim().uri().max(1000).allow(null, ''),
  productUrl: Joi.string().trim().uri().max(1000).allow(null, ''),
  designTemplateUrl: Joi.string().trim().uri().max(1000).allow(null, ''),
  minProductionDays: Joi.number().integer().min(0).allow(null),
  maxProductionDays: Joi.number().integer().min(0).allow(null),
  baseCostAmount: Joi.number().integer().min(0),
  currency: Joi.string().trim().uppercase().length(3),
  status: Joi.string().valid(...Object.values(recordStatuses)),
  metadata,
});

const updateVendorProductSchema = Joi.object({
  productTypeGroupId: objectId,
  name: Joi.string().trim().min(1).max(200),
  externalProductId: Joi.string().trim().max(120).allow(null, ''),
  imageUrl: Joi.string().trim().uri().max(1000).allow(null, ''),
  productUrl: Joi.string().trim().uri().max(1000).allow(null, ''),
  designTemplateUrl: Joi.string().trim().uri().max(1000).allow(null, ''),
  minProductionDays: Joi.number().integer().min(0).allow(null),
  maxProductionDays: Joi.number().integer().min(0).allow(null),
  baseCostAmount: Joi.number().integer().min(0),
  currency: Joi.string().trim().uppercase().length(3),
  status: Joi.string().valid(...Object.values(recordStatuses)),
  metadata,
}).min(1);

const shippingCostSchema = Joi.object({
  economyAmount: Joi.number().integer().min(0),
  additionalAmount: Joi.number().integer().min(0),
});

const additionalCostsSchema = Joi.object({
  embroideryAmount: Joi.number().integer().min(0),
  twoSidedPrintAmount: Joi.number().integer().min(0),
  twoPositionPrintAmount: Joi.number().integer().min(0),
});

const listVendorCostCentersQuerySchema = Joi.object({
  code: Joi.string().trim().uppercase().max(80),
  sku: Joi.string().trim().uppercase().max(120),
  standardSize: Joi.string().trim().max(80),
  standardColor: Joi.string().trim().max(80),
  status: Joi.string().valid(...Object.values(recordStatuses)),
  q: Joi.string().trim().max(160),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const createVendorCostCenterSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(1).max(80).required(),
  name: Joi.string().trim().min(1).max(200).required(),
  sku: Joi.string().trim().uppercase().max(120).allow(null, ''),
  lngCode: Joi.string().trim().uppercase().max(120).allow(null, ''),
  vendorSize: Joi.string().trim().max(80).allow(null, ''),
  vendorColor: Joi.string().trim().max(80).allow(null, ''),
  standardSize: Joi.string().trim().max(80).allow(null, ''),
  standardColor: Joi.string().trim().max(80).allow(null, ''),
  printMethod,
  attributes: Joi.object().unknown(true),
  weight: nonNegativeNumber.allow(null),
  weightUnit: Joi.string().trim().uppercase().max(20).allow(null, ''),
  width: nonNegativeNumber.allow(null),
  length: nonNegativeNumber.allow(null),
  height: nonNegativeNumber.allow(null),
  dimensionUnit: Joi.string().trim().uppercase().max(20).allow(null, ''),
  baseCostAmount: Joi.number().integer().min(0),
  currency: Joi.string().trim().uppercase().length(3),
  domesticShipping: shippingCostSchema,
  internationalShipping: shippingCostSchema,
  priorityShipping: shippingCostSchema,
  importTaxAmount: Joi.number().integer().min(0),
  additionalCosts: additionalCostsSchema,
  status: Joi.string().valid(...Object.values(recordStatuses)),
  metadata,
});

const updateVendorCostCenterSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200),
  sku: Joi.string().trim().uppercase().max(120).allow(null, ''),
  lngCode: Joi.string().trim().uppercase().max(120).allow(null, ''),
  vendorSize: Joi.string().trim().max(80).allow(null, ''),
  vendorColor: Joi.string().trim().max(80).allow(null, ''),
  standardSize: Joi.string().trim().max(80).allow(null, ''),
  standardColor: Joi.string().trim().max(80).allow(null, ''),
  printMethod,
  attributes: Joi.object().unknown(true),
  weight: nonNegativeNumber.allow(null),
  weightUnit: Joi.string().trim().uppercase().max(20).allow(null, ''),
  width: nonNegativeNumber.allow(null),
  length: nonNegativeNumber.allow(null),
  height: nonNegativeNumber.allow(null),
  dimensionUnit: Joi.string().trim().uppercase().max(20).allow(null, ''),
  baseCostAmount: Joi.number().integer().min(0),
  currency: Joi.string().trim().uppercase().length(3),
  domesticShipping: shippingCostSchema,
  internationalShipping: shippingCostSchema,
  priorityShipping: shippingCostSchema,
  importTaxAmount: Joi.number().integer().min(0),
  additionalCosts: additionalCostsSchema,
  status: Joi.string().valid(...Object.values(recordStatuses)),
  metadata,
}).min(1);

module.exports = {
  validate,
  listVendorsQuerySchema,
  createVendorSchema,
  updateVendorSchema,
  updateVendorIntegrationConfigSchema,
  refreshVendorIntegrationCredentialSchema,
  listVendorProductsQuerySchema,
  listVendorMigrationReviewsQuerySchema,
  assignVendorMigrationProductTypeGroupSchema,
  createVendorProductSchema,
  updateVendorProductSchema,
  listVendorCostCentersQuerySchema,
  createVendorCostCenterSchema,
  updateVendorCostCenterSchema,
};
