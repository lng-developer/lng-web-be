const Joi = require('joi');
const { hrCalendarOverrideKinds, hrEmployeeStatuses } = require('../constants/hr.constants');

const objectId = Joi.string().hex().length(24);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const scheduleStatuses = [hrEmployeeStatuses.ACTIVE, hrEmployeeStatuses.SUSPENDED];
const calendarScopeTypes = ['GLOBAL', 'WORK_LOCATION', 'DEPARTMENT', 'TEAM', 'PROFILE'];

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

function isValidDateKey(value) {
  if (!dateKeyPattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getShiftDurationMinutes(startTime, endTime) {
  if (!timePattern.test(startTime || '') || !timePattern.test(endTime || '')) return null;
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const start = (startHour * 60) + startMinute;
  const end = (endHour * 60) + endMinute;
  return end > start ? end - start : (end + 1440) - start;
}

function validTimezone(value, helpers) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch (_error) {
    return helpers.error('any.invalid');
  }
}

const time = Joi.string().trim().pattern(timePattern);
const endTime = time.custom((value, helpers) => {
  const { startTime } = helpers.state.ancestors[0] || {};
  const duration = getShiftDurationMinutes(startTime, value);
  return duration === null || duration <= 960 ? value : helpers.error('any.invalid');
});
const breakMinutes = Joi.number().integer().min(0).max(960).custom((value, helpers) => {
  const { startTime, endTime: shiftEndTime } = helpers.state.ancestors[0] || {};
  const duration = getShiftDurationMinutes(startTime, shiftEndTime);
  return duration === null || value < duration ? value : helpers.error('any.invalid');
});
const dateKey = Joi.string().trim().custom((value, helpers) => (
  isValidDateKey(value) ? value : helpers.error('any.invalid')
));
const code = Joi.string().trim().uppercase().min(1).max(80);
const name = Joi.string().trim().min(1).max(160);
const status = Joi.string().valid(...scheduleStatuses);

const workLocationFields = {
  code,
  name,
  timezone: Joi.string().trim().min(1).max(100).custom(validTimezone),
  status,
};

const shiftFields = {
  code,
  name,
  workLocationId: objectId.allow(null),
  startTime: time,
  endTime,
  breakMinutes,
  graceMinutes: Joi.number().integer().min(0).max(960),
  workdays: Joi.array().items(Joi.number().integer().min(1).max(7)).unique().min(1).max(7),
  status,
};

const createWorkLocationSchema = Joi.object({
  ...workLocationFields,
  code: code.required(),
  name: name.required(),
  timezone: workLocationFields.timezone.required(),
});
const updateWorkLocationSchema = Joi.object(workLocationFields).min(1);

const createShiftSchema = Joi.object({
  ...shiftFields,
  code: code.required(),
  name: name.required(),
  startTime: time.required(),
  endTime: endTime.required(),
});
const updateShiftSchema = Joi.object(shiftFields).min(1);

const assignmentFields = {
  profileId: objectId,
  shiftId: objectId,
  workLocationId: objectId,
  effectiveFrom: dateKey,
  effectiveTo: dateKey.allow(null),
  status,
};
const assignmentDateRule = (value, helpers) => (
  value.effectiveTo && value.effectiveTo < value.effectiveFrom
    ? helpers.error('any.invalid', { label: 'effectiveTo' })
    : value
);
const createAssignmentSchema = Joi.object({
  ...assignmentFields,
  profileId: objectId.required(),
  shiftId: objectId.required(),
  workLocationId: objectId.required(),
  effectiveFrom: dateKey.required(),
}).custom(assignmentDateRule);
const updateAssignmentSchema = Joi.object(assignmentFields).min(1);

const calendarOverrideFields = {
  dateKey,
  kind: Joi.string().valid(...Object.values(hrCalendarOverrideKinds)),
  scopeType: Joi.string().valid(...calendarScopeTypes),
  scopeId: objectId.allow(null),
  name,
  status,
};
const calendarScopeRule = (value, helpers) => {
  if (value.scopeType === 'GLOBAL' && value.scopeId !== null && value.scopeId !== undefined) {
    return helpers.error('any.invalid', { label: 'scopeId' });
  }
  if (value.scopeType !== 'GLOBAL' && !value.scopeId) return helpers.error('any.invalid', { label: 'scopeId' });
  return value;
};
const createCalendarOverrideSchema = Joi.object({
  ...calendarOverrideFields,
  dateKey: dateKey.required(),
  kind: calendarOverrideFields.kind.required(),
  scopeType: calendarOverrideFields.scopeType.required(),
  name: name.required(),
}).custom(calendarScopeRule);
const updateCalendarOverrideSchema = Joi.object(calendarOverrideFields).min(1);

const listScheduleSchema = Joi.object({
  status,
  q: Joi.string().trim().max(160),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  profileId: objectId,
  shiftId: objectId,
  workLocationId: objectId,
  effectiveFrom: dateKey,
  effectiveTo: dateKey,
  dateKey,
  scopeType: Joi.string().valid(...calendarScopeTypes),
  scopeId: objectId.allow(null),
}).custom(assignmentDateRule);
const idParamsSchema = Joi.object({ id: objectId.required() });

module.exports = {
  createAssignmentSchema,
  createCalendarOverrideSchema,
  createShiftSchema,
  createWorkLocationSchema,
  getShiftDurationMinutes,
  idParamsSchema,
  listScheduleSchema,
  updateAssignmentSchema,
  updateCalendarOverrideSchema,
  updateShiftSchema,
  updateWorkLocationSchema,
  validate,
};
