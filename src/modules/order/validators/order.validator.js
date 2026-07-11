const Joi = require('joi');
const { salesChannelCodes } = require('../constants/externalOrderSources');
const {
  caseStatuses,
  costCenterStatuses,
  orderCaseSeverities,
  orderCaseStatuses,
  orderStatuses,
  orderItemStatuses,
  orderListTabs,
  psdStatuses,
} = require('../constants/orderStatuses');

const objectIdSchema = Joi.string().hex().length(24);
const allowedOrderSortFields = new Set([
  'orderedAt',
  'shipByDate',
  'externalOrderId',
  'status',
  'salesChannelCode',
  'marketplaceCode',
  'createdAt',
  'updatedAt',
]);

function validateOrderSort(value, helpers) {
  if (!value) return value;

  const invalid = String(value).split(',')
    .map((field) => field.trim().replace(/^-/, ''))
    .find((field) => !allowedOrderSortFields.has(field));

  if (invalid) {
    return helpers.error('any.invalid', { message: `Unsupported sort field: ${invalid}` });
  }

  return value;
}

const paginationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const listOrdersQuerySchema = paginationQuerySchema.keys({
  tab: Joi.string().trim().uppercase().valid(...Object.values(orderListTabs)),
  shopId: objectIdSchema,
  orderId: Joi.string().trim().max(160),
  search: Joi.string().trim().max(160),
  seller: Joi.string().trim().max(160),
  employeeCode: Joi.string().trim().uppercase().max(80),
  assignedStaffId: objectIdSchema.allow(null, ''),
  sort: Joi.string().trim().max(300).custom(validateOrderSort),
  status: Joi.string().valid(...Object.values(orderStatuses)),
  costCenterStatus: Joi.string().trim().uppercase().valid(...Object.values(costCenterStatuses)),
  psdStatus: Joi.string().trim().uppercase().valid(...Object.values(psdStatuses)),
  caseStatus: Joi.string().trim().uppercase().valid(...Object.values(caseStatuses)),
  salesChannelCode: Joi.string().trim().uppercase().valid(...Object.values(salesChannelCodes)),
  marketplaceCode: Joi.string().trim().uppercase().max(80),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  createdAtFrom: Joi.date().iso(),
  createdAtTo: Joi.date().iso(),
  shipByDateFrom: Joi.date().iso(),
  shipByDateTo: Joi.date().iso(),
}).custom((value, helpers) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    return helpers.error('any.invalid', { message: 'dateFrom must be less than or equal to dateTo' });
  }

  if (value.shipByDateFrom && value.shipByDateTo && value.shipByDateFrom > value.shipByDateTo) {
    return helpers.error('any.invalid', { message: 'shipByDateFrom must be less than or equal to shipByDateTo' });
  }

  if (value.createdAtFrom && value.createdAtTo && value.createdAtFrom > value.createdAtTo) {
    return helpers.error('any.invalid', { message: 'createdAtFrom must be less than or equal to createdAtTo' });
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

const assignStaffSchema = Joi.object({
  assignedStaffId: objectIdSchema.allow(null).required(),
});

const buyerSchema = Joi.object({
  name: Joi.string().trim().allow(null, '').max(200),
  emailMasked: Joi.string().trim().allow(null, '').max(200),
  phoneMasked: Joi.string().trim().allow(null, '').max(120),
  externalBuyerId: Joi.string().trim().allow(null, '').max(160),
}).min(1);

const shippingServiceSchema = Joi.object({
  level: Joi.string().trim().allow(null, '').max(120),
  name: Joi.string().trim().allow(null, '').max(200),
}).min(1);

const caseStatusSchema = Joi.object({
  caseStatus: Joi.string().valid('NONE', 'OPEN').required(),
});

const orderCaseIdParamSchema = Joi.object({
  caseId: objectIdSchema.required(),
});

const listOrderCasesQuerySchema = paginationQuerySchema.keys({
  orderId: objectIdSchema,
  orderItemId: objectIdSchema,
  shopId: objectIdSchema,
  status: Joi.string().trim().uppercase().valid(...Object.values(orderCaseStatuses)),
  caseType: Joi.string().trim().uppercase().max(80),
  severity: Joi.string().trim().uppercase().valid(...Object.values(orderCaseSeverities)),
  q: Joi.string().trim().max(160),
});

const createOrderCaseSchema = Joi.object({
  orderId: objectIdSchema.required(),
  orderItemId: objectIdSchema.allow(null, ''),
  caseType: Joi.string().trim().uppercase().max(80).default('OTHER'),
  severity: Joi.string().trim().uppercase().valid(...Object.values(orderCaseSeverities)).default('MEDIUM'),
  title: Joi.string().trim().max(240).required(),
  description: Joi.string().trim().allow(null, '').max(4000),
});

const updateOrderCaseSchema = Joi.object({
  caseType: Joi.string().trim().uppercase().max(80),
  severity: Joi.string().trim().uppercase().valid(...Object.values(orderCaseSeverities)),
  title: Joi.string().trim().max(240),
  description: Joi.string().trim().allow(null, '').max(4000),
}).min(1);

const resolveOrderCaseSchema = Joi.object({
  resolutionNote: Joi.string().trim().allow(null, '').max(4000),
});

const cancelOrderCaseSchema = Joi.object({
  cancelReason: Joi.string().trim().allow(null, '').max(4000),
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
  listOrdersQuerySchema,
  orderIdParamSchema,
  listOrderItemsQuerySchema,
  orderItemIdParamSchema,
  shippingAddressSchema,
  assignStaffSchema,
  buyerSchema,
  shippingServiceSchema,
  caseStatusSchema,
  orderCaseIdParamSchema,
  listOrderCasesQuerySchema,
  createOrderCaseSchema,
  updateOrderCaseSchema,
  resolveOrderCaseSchema,
  cancelOrderCaseSchema,
  paginationQuerySchema,
  validate,
};
