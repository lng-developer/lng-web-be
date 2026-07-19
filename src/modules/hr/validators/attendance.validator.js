const Joi = require('joi');
const { hrAttendanceStatuses } = require('../constants/hr.constants');

const objectId = Joi.string().hex().length(24);
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: false,
    convert: true,
  });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

function validDateKey(value, helpers) {
  if (!dateKeyPattern.test(value || '')) return helpers.error('any.invalid');
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : helpers.error('any.invalid');
}

const dateKey = Joi.string().trim().custom(validDateKey);
const instant = Joi.string().isoDate();

const attendanceEventSchema = Joi.object({
  occurredAt: instant.required(),
}).unknown(false);

const listFields = {
  status: Joi.string().valid(...Object.values(hrAttendanceStatuses)),
  dateFrom: dateKey,
  dateTo: dateKey,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
};
const dateRangeRule = (value, helpers) => (
  value.dateFrom && value.dateTo && value.dateTo < value.dateFrom
    ? helpers.error('any.invalid')
    : value
);
const listAttendanceSchema = Joi.object({
  ...listFields,
  profileId: objectId,
  exceptionsOnly: Joi.boolean(),
})
  .custom(dateRangeRule)
  .unknown(false);
const listMyAttendanceSchema = Joi.object(listFields)
  .custom(dateRangeRule)
  .unknown(false);

const adjustAttendanceSchema = Joi.object({
  status: Joi.string().valid(...Object.values(hrAttendanceStatuses)),
  checkInAt: instant.allow(null),
  checkOutAt: instant.allow(null),
  reason: Joi.string().trim().min(1).max(500).required(),
}).custom((value, helpers) => (
  ['status', 'checkInAt', 'checkOutAt'].some((key) => Object.hasOwn(value, key))
    ? value
    : helpers.error('object.missing')
)).unknown(false);

const attendanceIdParamsSchema = Joi.object({ attendanceId: objectId.required() }).unknown(false);

module.exports = {
  adjustAttendanceSchema,
  attendanceEventSchema,
  attendanceIdParamsSchema,
  listAttendanceSchema,
  listMyAttendanceSchema,
  validate,
};
