const Joi = require('joi');
const { shopStatuses } = require('../models/shop.model');

const listShopsQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(shopStatuses)),
  search: Joi.string().trim().max(120),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const createShopSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160).required(),
  currency: Joi.string().trim().uppercase().length(3),
});

const updateShopStatusSchema = Joi.object({
  status: Joi.string().valid(...Object.values(shopStatuses)).required(),
});

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (!result.error) {
    return { value: result.value };
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
  listShopsQuerySchema,
  createShopSchema,
  updateShopStatusSchema,
  validate,
};
