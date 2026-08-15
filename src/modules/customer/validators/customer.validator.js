const Joi = require('joi');

const listCustomersSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().allow('', null),
  lifecycle: Joi.string().valid('NEW', 'RETURNING', 'VIP', 'AT_RISK', 'ISSUE_PRONE'),
  careStatus: Joi.string().valid('NONE', 'NEEDS_FOLLOW_UP', 'IN_PROGRESS', 'RESOLVED'),
  status: Joi.string().valid('ACTIVE', 'WATCHLIST', 'BLOCKED', 'ARCHIVED'),
  countryCode: Joi.string().trim().allow('', null),
  shopId: Joi.string().hex().length(24),
  salesChannelCode: Joi.string().trim().uppercase(),
  orderedFrom: Joi.date().iso(),
  orderedTo: Joi.date().iso(),
  minOrderCount: Joi.number().integer().min(0),
  minRevenue: Joi.number().min(0),
  sort: Joi.string().valid('lastOrderDesc', 'revenueDesc', 'orderCountDesc', 'firstOrderDesc').default('lastOrderDesc'),
});

const exportCustomersSchema = listCustomersSchema.keys({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(5000).default(5000),
});

const timelineSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

const noteSchema = Joi.object({
  body: Joi.string().trim().min(1).max(2000).required(),
  type: Joi.string().valid('GENERAL', 'CARE', 'ISSUE', 'REFUND', 'ADDRESS', 'VIP').default('GENERAL'),
  careStatus: Joi.string().valid('NONE', 'NEEDS_FOLLOW_UP', 'IN_PROGRESS', 'RESOLVED'),
});

const careStatusSchema = Joi.object({
  careStatus: Joi.string().valid('NONE', 'NEEDS_FOLLOW_UP', 'IN_PROGRESS', 'RESOLVED').required(),
  note: Joi.string().trim().allow('', null).max(2000),
});

function assertValid(schema, payload) {
  const { value, error } = schema.validate(payload, { abortEarly: false, stripUnknown: true });
  if (error) {
    error.statusCode = 400;
    throw error;
  }
  return value;
}

module.exports = {
  assertValid,
  careStatusSchema,
  exportCustomersSchema,
  listCustomersSchema,
  noteSchema,
  timelineSchema,
};
