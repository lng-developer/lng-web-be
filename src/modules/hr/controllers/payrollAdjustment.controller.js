const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/payrollAdjustment.service');
const {
  adjustmentParamsSchema,
  cancelAdjustmentSchema,
  createAdjustmentSchema,
  listAdjustmentsSchema,
  updateAdjustmentSchema,
  validate,
} = require('../validators/payroll.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  return value;
}

async function listAdjustments(req, res) {
  const query = assertValid(listAdjustmentsSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listAdjustments(query, req.auth) });
}

async function createAdjustment(req, res) {
  const payload = assertValid(createAdjustmentSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createAdjustment(payload, req.auth) });
}

async function updateAdjustment(req, res) {
  const { id } = assertValid(adjustmentParamsSchema, req.params);
  const payload = assertValid(updateAdjustmentSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateAdjustment(id, payload, req.auth) });
}

async function cancelAdjustment(req, res) {
  const { id } = assertValid(adjustmentParamsSchema, req.params);
  const { expectedVersion } = assertValid(cancelAdjustmentSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.cancelAdjustment(id, expectedVersion, req.auth) });
}

module.exports = { cancelAdjustment, createAdjustment, listAdjustments, updateAdjustment };
