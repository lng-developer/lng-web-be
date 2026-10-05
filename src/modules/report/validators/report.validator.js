const Joi = require('joi');

const objectId = Joi.string().hex().length(24);

function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, stripUnknown: true, convert: true });

  if (!result.error) return { value: result.value };

  return {
    value: result.value,
    details: result.error.details.map((detail) => ({ message: detail.message, path: detail.path, type: detail.type })),
  };
}

const baseReportQuerySchema = Joi.object({
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  shopId: objectId,
  salesChannelCode: Joi.string().trim().uppercase(),
  marketplaceCode: Joi.string().trim().uppercase(),
  sellerEmployeeCode: Joi.string().trim().uppercase(),
  adStatus: Joi.string().trim().uppercase().valid('ENABLED', 'PAUSED', 'ARCHIVED'),
  sellerAttributionSource: Joi.string().trim().uppercase().valid('CAMPAIGN_NAME', 'PORTFOLIO_NAME', 'UNASSIGNED'),
  teamId: objectId,
  departmentId: objectId,
});

const financeReportQuerySchema = baseReportQuerySchema.keys({
  dateBasis: Joi.string().trim().uppercase().valid('ORDERED_AT', 'CALCULATED_AT').default('ORDERED_AT'),
});

const financeOrderProfitabilityQuerySchema = financeReportQuerySchema.keys({
  costCoverage: Joi.string().trim().uppercase().valid('MISSING', 'COMPLETE'),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const vendorPerformanceQuerySchema = baseReportQuerySchema.keys({
  vendorId: objectId,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(500),
});

module.exports = {
  baseReportQuerySchema,
  financeReportQuerySchema,
  financeOrderProfitabilityQuerySchema,
  validate,
  vendorPerformanceQuerySchema,
};
