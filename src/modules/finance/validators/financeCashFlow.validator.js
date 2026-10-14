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

const listCashFlowQuerySchema = Joi.object({
  shopId: objectId,
  salesChannelCode: Joi.string().trim().uppercase(),
  marketplaceCode: Joi.string().trim().uppercase(),
  currency: Joi.string().trim().uppercase().length(3),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  status: Joi.string().valid('LINKED', 'UNLINKED', 'NEEDS_REVIEW'),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

module.exports = { listCashFlowQuerySchema, validate };
