const Joi = require('joi');
const { salesChannelCodes } = require('../constants/externalOrderSources');
const { orderStatuses, orderItemStatuses } = require('../constants/orderStatuses');

const objectIdSchema = Joi.string().hex().length(24);
const paginationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const listOrdersQuerySchema = paginationQuerySchema.keys({
  shopId: objectIdSchema,
  status: Joi.string().valid(...Object.values(orderStatuses)),
  salesChannelCode: Joi.string().trim().uppercase().valid(...Object.values(salesChannelCodes)),
  marketplaceCode: Joi.string().trim().uppercase().max(80),
  externalOrderId: Joi.string().trim().max(160),
  orderedAtFrom: Joi.date().iso(),
  orderedAtTo: Joi.date().iso(),
  shipByDateFrom: Joi.date().iso(),
  shipByDateTo: Joi.date().iso(),
}).custom((value, helpers) => {
  if (value.orderedAtFrom && value.orderedAtTo && value.orderedAtFrom > value.orderedAtTo) {
    return helpers.error('any.invalid', { message: 'orderedAtFrom must be less than or equal to orderedAtTo' });
  }

  if (value.shipByDateFrom && value.shipByDateTo && value.shipByDateFrom > value.shipByDateTo) {
    return helpers.error('any.invalid', { message: 'shipByDateFrom must be less than or equal to shipByDateTo' });
  }

  return value;
});

const listOrderItemsQuerySchema = paginationQuerySchema.keys({
  status: Joi.string().valid(...Object.values(orderItemStatuses)),
});

const orderIdParamSchema = Joi.object({
  orderId: objectIdSchema.required(),
});

const orderItemIdParamSchema = Joi.object({
  orderItemId: objectIdSchema.required(),
});

const shippingAddressSchema = Joi.object({
  name: Joi.string().trim().allow(null, '').max(200),
  company: Joi.string().trim().allow(null, '').max(200),
  addressLine1: Joi.string().trim().allow(null, '').max(300),
  addressLine2: Joi.string().trim().allow(null, '').max(300),
  addressLine3: Joi.string().trim().allow(null, '').max(300),
  addressType: Joi.string().trim().uppercase().allow(null, '').max(80),
  city: Joi.string().trim().allow(null, '').max(160),
  stateOrProvince: Joi.string().trim().allow(null, '').max(160),
  stateOrProvinceCode: Joi.string().trim().uppercase().allow(null, '').max(80),
  postalCode: Joi.string().trim().uppercase().allow(null, '').max(80),
  country: Joi.string().trim().allow(null, '').max(160),
  countryCode: Joi.string().trim().uppercase().allow(null).length(2),
  phoneMasked: Joi.string().trim().allow(null, '').max(120),
}).min(1);

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
  listOrdersQuerySchema,
  orderIdParamSchema,
  listOrderItemsQuerySchema,
  orderItemIdParamSchema,
  shippingAddressSchema,
  paginationQuerySchema,
  validate,
};
