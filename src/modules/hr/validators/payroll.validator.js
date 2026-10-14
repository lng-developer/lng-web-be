const Joi = require('joi');

const objectId = Joi.string().hex().length(24);
const month = Joi.number().integer().min(1).max(12);
const year = Joi.number().integer().min(2000).max(2100);
const expectedVersion = Joi.number().integer().min(0);

function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, stripUnknown: true, convert: true });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

const runPayrollSchema = Joi.object({
  month: month.required(),
  year: year.required(),
  profileIds: Joi.array().items(objectId).unique().max(500).default([]),
  shadow: Joi.boolean().default(false),
});
const listPayrollSchema = Joi.object({
  month, year,
  status: Joi.string().valid('DRAFT', 'FINALIZED', 'PAID'),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});
const listMyPayrollSchema = listPayrollSchema.fork(['status'], (schema) => schema.forbidden()).keys({ resultId: objectId });
const listPayrollResultsSchema = Joi.object({
  payrollRunId: objectId,
  month,
  year,
  status: Joi.string().valid('DRAFT', 'FINALIZED', 'PAID'),
  q: Joi.string().trim().max(100),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
}).and('month', 'year').xor('payrollRunId', 'month');
const exportPayrollResultsSchema = listPayrollResultsSchema.fork(['page', 'limit'], (schema) => schema.forbidden());
const payrollRunParamsSchema = Joi.object({ id: objectId.required() });
const payrollResultParamsSchema = Joi.object({ resultId: objectId.required() });
const finalizePayrollSchema = Joi.object({ expectedVersion: expectedVersion.required() });
const markPaidSchema = Joi.object({
  payrollResultIds: Joi.array().items(objectId.required()).unique().min(1).max(500).required(),
  expectedVersion: expectedVersion.required(),
});
const emailPayrollSchema = Joi.object({});

const basisPoints = Joi.number().integer().min(0).max(100000);
const payrollSettingsUpdateSchema = Joi.object({
  expectedVersion: expectedVersion.required(),
  formulaVersion: Joi.string().trim().min(1).max(100),
  adjustmentTypes: Joi.array().items(Joi.string().uppercase().pattern(/^[A-Z][A-Z0-9_]{0,49}$/)).unique().min(1).max(50),
  adjustmentCodes: Joi.array().items(Joi.string().uppercase().pattern(/^[A-Z][A-Z0-9_]{0,49}$/)).unique().min(1).max(100),
  paidLeaveTypes: Joi.array().items(Joi.string().uppercase().pattern(/^[A-Z][A-Z0-9_]{0,49}$/)).unique().max(50),
  workHoursPerDay: Joi.number().positive().max(24),
  workUnitScale: Joi.number().integer().positive().max(1000000),
  rateScale: Joi.number().integer().positive().max(1000000),
  probationRateBasisPoints: basisPoints,
  otRateBasisPoints: Joi.object({
    weekday: basisPoints, weekend: basisPoints, holiday: basisPoints,
    weekday_night: basisPoints, weekend_night: basisPoints, holiday_night: basisPoints,
  }),
  insuranceRates: Joi.object({ social: basisPoints, health: basisPoints, unemployment: basisPoints }),
  insuranceCap: Joi.number().integer().min(0),
  personalDeduction: Joi.number().integer().min(0),
  dependantDeduction: Joi.number().integer().min(0),
  pitBrackets: Joi.array().items(Joi.array().ordered(
    Joi.number().integer().positive().required(), basisPoints.required(),
  ).length(2)).min(1).max(20),
  company: Joi.object({
    name: Joi.string().trim().min(1).max(200),
    logoUrl: Joi.string().uri().max(2000).allow(null, ''),
    address: Joi.string().trim().max(500).allow(''),
    taxCode: Joi.string().trim().max(100).allow(''),
    payrollEmail: Joi.string().email().max(200).allow(''),
    payrollPhone: Joi.string().trim().max(50).allow(''),
    currency: Joi.string().uppercase().length(3),
  }),
}).or(
  'formulaVersion', 'adjustmentTypes', 'adjustmentCodes', 'paidLeaveTypes', 'workHoursPerDay',
  'workUnitScale', 'rateScale', 'probationRateBasisPoints', 'otRateBasisPoints', 'insuranceRates',
  'insuranceCap', 'personalDeduction', 'dependantDeduction', 'pitBrackets', 'company',
);

const adjustmentType = Joi.string().uppercase().pattern(/^[A-Z][A-Z0-9_]{0,49}$/);
const adjustmentCode = Joi.string().uppercase().pattern(/^[A-Z][A-Z0-9_]{0,49}$/);
const adjustmentFields = {
  type: adjustmentType,
  code: adjustmentCode,
  name: Joi.string().trim().min(1).max(200),
  amount: Joi.number().integer().min(1),
  note: Joi.string().trim().max(500).allow('', null),
};
const baseAdjustmentSchema = {
  month: month.required(),
  year: year.required(),
  type: adjustmentFields.type.required(),
  code: adjustmentFields.code.required(),
  name: adjustmentFields.name.required(),
  amount: adjustmentFields.amount.required(),
  note: adjustmentFields.note,
};
const createAdjustmentSchema = Joi.object({
  profileId: objectId.required(),
  ...baseAdjustmentSchema,
});
const createBulkAdjustmentSchema = Joi.object({
  profileIds: Joi.array().items(objectId.required()).unique().min(1).max(500).required(),
  ...baseAdjustmentSchema,
});
const updateAdjustmentSchema = Joi.object({
  ...adjustmentFields,
  expectedVersion: expectedVersion.required(),
}).or('type', 'code', 'name', 'amount', 'note');
const cancelAdjustmentSchema = Joi.object({ expectedVersion: expectedVersion.required() });
const adjustmentParamsSchema = Joi.object({ id: objectId.required() });
const listAdjustmentsSchema = Joi.object({
  profileId: objectId,
  month,
  year,
  status: Joi.string().valid('APPROVED', 'CANCELLED'),
  type: adjustmentType,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

module.exports = {
  adjustmentParamsSchema,
  cancelAdjustmentSchema,
  createAdjustmentSchema,
  createBulkAdjustmentSchema,
  emailPayrollSchema,
  exportPayrollResultsSchema,
  finalizePayrollSchema,
  listAdjustmentsSchema,
  listMyPayrollSchema,
  listPayrollResultsSchema,
  listPayrollSchema,
  markPaidSchema,
  payrollRunParamsSchema,
  payrollResultParamsSchema,
  payrollSettingsUpdateSchema,
  runPayrollSchema,
  updateAdjustmentSchema,
  validate,
};
