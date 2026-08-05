const Joi = require('joi');
const { hrRequestStatuses } = require('../constants/hr.constants');

const objectId = Joi.string().hex().length(24);
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

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

function minuteOfDay(value) {
  const [hour, minute] = value.split(':').map(Number);
  return (hour * 60) + minute;
}

function validDuration(value, helpers) {
  const start = minuteOfDay(value.plannedStartTime);
  let end = minuteOfDay(value.plannedEndTime);
  if (end <= start) end += 1440;
  const duration = end - start;
  return duration >= 30 && duration <= 960 ? value : helpers.error('any.invalid');
}

const dateKey = Joi.string().trim().custom(validDateKey);
const reason = Joi.string().trim().min(1).max(500);

const createRequestSchema = Joi.object({
  workDateKey: dateKey.required(),
  plannedStartTime: Joi.string().pattern(timePattern).required(),
  plannedEndTime: Joi.string().pattern(timePattern).required(),
  reason: reason.required(),
}).custom(validDuration);

const listRequestsSchema = Joi.object({
  dateFrom: dateKey,
  dateTo: dateKey,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  profileId: objectId,
  status: Joi.string().valid(...Object.values(hrRequestStatuses)),
});
const listMyRequestsSchema = listRequestsSchema.fork(['profileId'], (schema) => schema.forbidden());
const requestIdParamsSchema = Joi.object({ requestId: objectId.required() });
const approveSchema = Joi.object({
  approvedMinutes: Joi.number().integer().min(1),
  reason: reason,
});
const decisionSchema = Joi.object({ reason: reason.required() });
const cancelSchema = Joi.object({ reason });

module.exports = {
  approveSchema,
  cancelSchema,
  createRequestSchema,
  decisionSchema,
  listMyRequestsSchema,
  listRequestsSchema,
  requestIdParamsSchema,
  validate,
};
