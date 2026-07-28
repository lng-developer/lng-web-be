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
  profileIds: Joi.array().items(objectId.required()).unique().max(500).default([]),
  shadow: Joi.boolean().default(false),
});
const listPayrollSchema = Joi.object({
  month, year,
  status: Joi.string().valid('DRAFT', 'FINALIZED', 'PAID'),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});
const listMyPayrollSchema = listPayrollSchema.fork(['status'], (schema) => schema.forbidden());
const listPayrollResultsSchema = Joi.object({
  payrollRunId: objectId,
  month,
  year,
  status: Joi.string().valid('DRAFT', 'FINALIZED', 'PAID'),
  q: Joi.string().trim().max(100),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
}).and('month', 'year').xor('payrollRunId', 'month');
const payrollRunParamsSchema = Joi.object({ id: objectId.required() });
const payrollResultParamsSchema = Joi.object({ resultId: objectId.required() });
const finalizePayrollSchema = Joi.object({ expectedVersion: expectedVersion.required() });
const markPaidSchema = Joi.object({
  payrollResultIds: Joi.array().items(objectId.required()).unique().min(1).max(500).required(),
  expectedVersion: expectedVersion.required(),
});
const emailPayrollSchema = Joi.object({});

const adjustmentType = Joi.string().valid('EARNING', 'ALLOWANCE', 'DEDUCTION');
const adjustmentCode = Joi.string().uppercase().valid('BONUS', 'PENALTY', 'ADVANCE', 'ARREARS', 'OTHER');
const adjustmentFields = {
  type: adjustmentType,
  code: adjustmentCode,
  name: Joi.string().trim().min(1).max(200),
  amount: Joi.number().integer().min(0),
  note: Joi.string().trim().max(500).allow('', null),
};
const createAdjustmentSchema = Joi.object({
  profileId: objectId.required(),
  month: month.required(),
  year: year.required(),
  type: adjustmentFields.type.required(),
  code: adjustmentFields.code.required(),
  name: adjustmentFields.name.required(),
  amount: adjustmentFields.amount.required(),
  note: adjustmentFields.note,
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
  emailPayrollSchema,
  finalizePayrollSchema,
  listAdjustmentsSchema,
  listMyPayrollSchema,
  listPayrollResultsSchema,
  listPayrollSchema,
  markPaidSchema,
  payrollRunParamsSchema,
  payrollResultParamsSchema,
  runPayrollSchema,
  updateAdjustmentSchema,
  validate,
};
