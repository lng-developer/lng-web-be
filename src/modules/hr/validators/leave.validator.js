const Joi = require('joi');
const { hrLeaveTypes, hrRequestStatuses } = require('../constants/hr.constants');

const objectId = Joi.string().hex().length(24);
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

function validDateKey(value, helpers) {
  if (!dateKeyPattern.test(value)) return helpers.error('any.invalid');
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : helpers.error('any.invalid');
}

const dateKey = Joi.string().trim().custom(validDateKey);
const year = Joi.number().integer().min(2000).max(2100);
const leaveType = Joi.string().valid(...Object.values(hrLeaveTypes));
const reason = Joi.string().trim().min(1).max(500);
const portion = Joi.string().valid('FULL_DAY', 'MORNING', 'AFTERNOON');
const profileIds = Joi.array().items(objectId).unique().max(500);
const attachments = Joi.array().items(Joi.object({
  mediaId: Joi.string().trim().pattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/).required(),
  filename: Joi.string().trim().max(255).allow(null),
  mimeType: Joi.string().trim().max(100).allow(null),
})).unique('mediaId').max(20);

function requestDateRule(value, helpers) {
  if (value.endDateKey < value.startDateKey) return helpers.error('any.invalid');
  if (value.startDateKey.slice(0, 4) !== value.endDateKey.slice(0, 4)) return helpers.error('any.invalid');
  if (value.portion !== 'FULL_DAY' && value.startDateKey !== value.endDateKey) {
    return helpers.error('any.invalid');
  }
  return value;
}

const createRequestSchema = Joi.object({
  leaveType: leaveType.required(),
  portion: portion.required(),
  startDateKey: dateKey.required(),
  endDateKey: dateKey.required(),
  reason: reason.required(),
  attachments,
}).custom(requestDateRule);

const listRequestsSchema = Joi.object({
  dateFrom: dateKey,
  dateTo: dateKey,
  leaveType,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  profileId: objectId,
  status: Joi.string().valid(...Object.values(hrRequestStatuses)),
  year,
});

const listMyRequestsSchema = listRequestsSchema.fork(['profileId'], (schema) => schema.forbidden());
const balanceYearQuerySchema = Joi.object({ year: year.required() });
const balanceParamsSchema = Joi.object({
  profileId: objectId.required(),
  year: year.required(),
  leaveType: leaveType.required(),
});
const upsertBalanceSchema = Joi.object({
  entitledUnits: Joi.number().integer().min(0).required(),
  adjustmentUnits: Joi.number().integer().required(),
  reason: reason.required(),
});
const requestIdParamsSchema = Joi.object({ requestId: objectId.required() });
const decisionSchema = Joi.object({ reason: reason.required() });
const cancelSchema = Joi.object({ reason });
const emptyActionSchema = Joi.object({}).max(0);
const adjustBalanceSchema = Joi.object({
  units: Joi.number().integer().invalid(0).required(),
  reason: reason.required(),
});
const accrueBalancesSchema = Joi.object({
  profileIds,
  year: year.required(),
  month: Joi.number().integer().min(1).max(12).required(),
  units: Joi.number().integer().min(1).default(2),
  reason: reason.required(),
});
const resetBalancesSchema = Joi.object({
  profileIds,
  year: year.required(),
  leaveType: leaveType.default('ANNUAL'),
  entitledUnits: Joi.number().integer().min(0).required(),
  reason: reason.required(),
});
const carryOverBalancesSchema = Joi.object({
  profileIds,
  fromYear: year.required(),
  toYear: year.required(),
  leaveType: leaveType.default('ANNUAL'),
  maxUnits: Joi.number().integer().min(0).required(),
  reason: reason.required(),
});
const attachmentSchema = Joi.object({ attachments: attachments.required() });
const refundSchema = Joi.object({
  dateKeys: Joi.array().items(dateKey.required()).unique().min(1).max(366).required(),
  reason: reason.required(),
});

module.exports = {
  accrueBalancesSchema,
  adjustBalanceSchema,
  attachmentSchema,
  balanceParamsSchema,
  balanceYearQuerySchema,
  createRequestSchema,
  carryOverBalancesSchema,
  cancelSchema,
  decisionSchema,
  emptyActionSchema,
  listMyRequestsSchema,
  listRequestsSchema,
  requestIdParamsSchema,
  refundSchema,
  resetBalancesSchema,
  upsertBalanceSchema,
  validate,
};
