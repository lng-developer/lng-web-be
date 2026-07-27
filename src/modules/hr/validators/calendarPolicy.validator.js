const Joi = require('joi');
const { hrHolidayTypes } = require('../constants/hr.constants');

const objectId = Joi.string().hex().length(24);
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, stripUnknown: true, convert: true });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

function validDateKey(value, helpers) {
  if (!dateKeyPattern.test(value || '')) return helpers.error('date.format');
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : helpers.error('date.format');
}

const dateKey = Joi.string().custom(validDateKey, 'valid date key');
const holidayFields = {
  name: Joi.string().trim().min(1).max(160),
  dateKey,
  date: Joi.date().iso(),
  isWorkDay: Joi.boolean(),
  holidayType: Joi.string().valid(...Object.values(hrHolidayTypes)),
  appliedDepartmentIds: Joi.array().items(objectId).unique(),
  appliedTeamIds: Joi.array().items(objectId).unique(),
  note: Joi.string().trim().max(500).allow(null, ''),
  isActive: Joi.boolean(),
};

const createHolidaySchema = Joi.object({
  ...holidayFields,
  name: holidayFields.name.required(),
  holidayType: holidayFields.holidayType.required(),
}).or('dateKey', 'date');
const updateHolidaySchema = Joi.object(holidayFields).min(1);
const bulkImportHolidaySchema = Joi.object({ items: Joi.array().items(createHolidaySchema).min(1).max(100).required() });
const holidayListSchema = Joi.object({
  dateFrom: dateKey,
  dateTo: dateKey,
  departmentId: objectId,
  teamId: objectId,
  holidayType: holidayFields.holidayType,
  isWorkDay: Joi.boolean(),
  isActive: Joi.boolean(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});
const holidayRangeSchema = Joi.object({
  dateFrom: dateKey.required(),
  dateTo: dateKey.required(),
  departmentId: objectId,
  teamId: objectId,
});
const holidayCheckSchema = Joi.object({ dateKey: dateKey.required(), departmentId: objectId, teamId: objectId });
const idParamsSchema = Joi.object({ id: objectId.required() });
const yearParamsSchema = Joi.object({ year: Joi.number().integer().min(2000).max(9999).required() });
const teamParamsSchema = Joi.object({ teamId: objectId.required() });

const customRotationSchema = Joi.object({
  dateKey: dateKey.required(),
  employeeProfileIds: Joi.array().items(objectId).unique().required(),
});
const generateRotationSchema = Joi.object({
  teamId: objectId.required(),
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2000).max(9999).required(),
  minPresent: Joi.number().integer().min(0),
  customRotations: Joi.array().items(customRotationSchema).unique('dateKey'),
});
const updateRotationSchema = Joi.object({ employeeProfileIds: Joi.array().items(objectId).unique().required() });
const rotationListSchema = Joi.object({
  teamId: objectId,
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2000).max(9999),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});
const deleteTeamRotationsSchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2000).max(9999).required(),
});

module.exports = {
  bulkImportHolidaySchema,
  createHolidaySchema,
  deleteTeamRotationsSchema,
  generateRotationSchema,
  holidayCheckSchema,
  holidayListSchema,
  holidayRangeSchema,
  idParamsSchema,
  rotationListSchema,
  teamParamsSchema,
  updateHolidaySchema,
  updateRotationSchema,
  validate,
  yearParamsSchema,
};
