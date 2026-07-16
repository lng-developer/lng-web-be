const Joi = require('joi');

const objectId = Joi.string().hex().length(24);
const optionalObjectId = objectId.allow(null);

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

const selectFulfillmentPlanSchema = Joi.object({
  vendorProductId: objectId.required(),
  vendorCostCenterId: objectId.required(),
});

const searchVendorCandidatesSchema = Joi.object({
  q: Joi.string().trim().max(120).allow('', null),
  vendorId: optionalObjectId,
  vendorProductId: optionalObjectId,
  productTypeGroupId: optionalObjectId,
  size: Joi.string().trim().max(80).allow('', null),
  color: Joi.string().trim().max(80).allow('', null),
  sku: Joi.string().trim().max(120).allow('', null),
  lngCode: Joi.string().trim().max(120).allow('', null),
  includeDifferentProductType: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const configWorkbenchQuerySchema = Joi.object({
  shopId: objectId,
  salesChannelCode: Joi.string().trim().max(40),
  marketplaceCode: Joi.string().trim().max(40),
  configCode: Joi.string().trim().uppercase().max(40),
  productTypeGroupId: objectId,
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
  sampleLimit: Joi.number().integer().min(1).max(50).default(10),
});

const recheckUnmatchedSchema = Joi.object({
  shopId: objectId,
  salesChannelCode: Joi.string().trim().max(40),
  marketplaceCode: Joi.string().trim().max(40),
  status: Joi.string().trim().max(40),
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

const summaryQuerySchema = Joi.object({
  shopId: objectId,
  salesChannelCode: Joi.string().trim().max(40),
  marketplaceCode: Joi.string().trim().max(40),
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

module.exports = {
  confirmFulfillmentPlanSchema: selectFulfillmentPlanSchema,
  configWorkbenchQuerySchema,
  objectId,
  optionalObjectId,
  recheckUnmatchedSchema,
  searchVendorCandidatesSchema,
  selectFulfillmentPlanSchema,
  summaryQuerySchema,
  validate,
};
