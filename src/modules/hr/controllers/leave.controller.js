const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/leave.service');
const {
  accrueBalancesSchema,
  adjustBalanceSchema,
  attachmentSchema,
  balanceParamsSchema,
  balanceYearQuerySchema,
  cancelSchema,
  createRequestSchema,
  carryOverBalancesSchema,
  decisionSchema,
  emptyActionSchema,
  listMyRequestsSchema,
  listRequestsSchema,
  requestIdParamsSchema,
  refundSchema,
  resetBalancesSchema,
  upsertBalanceSchema,
  validate,
} = require('../validators/leave.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
}

async function getMyBalances(req, res) {
  const { year } = assertValid(balanceYearQuerySchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.getMyBalances(year, req.auth) });
}

async function getBalance(req, res) {
  const { profileId, year, leaveType } = assertValid(balanceParamsSchema, req.params);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getBalance(profileId, year, leaveType, req.auth),
  });
}

async function upsertBalance(req, res) {
  const { profileId, year, leaveType } = assertValid(balanceParamsSchema, req.params);
  const payload = assertValid(upsertBalanceSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.upsertBalance(profileId, year, leaveType, payload, req.auth),
  });
}

async function createRequest(req, res) {
  const payload = assertValid(createRequestSchema, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: await service.createRequest(payload, req.auth) });
}

async function updateRequest(req, res) {
  const { requestId } = assertValid(requestIdParamsSchema, req.params);
  const payload = assertValid(createRequestSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.updateRequest(requestId, payload, req.auth) });
}

async function previewRequest(req, res) {
  const payload = assertValid(createRequestSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.previewRequest(payload, req.auth) });
}

async function adjustBalance(req, res) {
  const { profileId, year, leaveType } = assertValid(balanceParamsSchema, req.params);
  const payload = assertValid(adjustBalanceSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.adjustBalance(profileId, year, leaveType, payload, req.auth),
  });
}

async function accrueBalances(req, res) {
  const payload = assertValid(accrueBalancesSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.accrueBalances(payload, req.auth) });
}

async function resetBalances(req, res) {
  const payload = assertValid(resetBalancesSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.resetBalances(payload, req.auth) });
}

async function carryOverBalances(req, res) {
  const payload = assertValid(carryOverBalancesSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.carryOverBalances(payload, req.auth) });
}

async function attachReferences(req, res) {
  const { requestId } = assertValid(requestIdParamsSchema, req.params);
  const payload = assertValid(attachmentSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.attachReferences(requestId, payload, req.auth) });
}

async function listRequests(req, res) {
  const query = assertValid(listRequestsSchema, req.query);
  res.status(httpStatus.OK).json({ success: true, data: await service.listRequests(query, req.auth) });
}

async function listMyRequests(req, res) {
  const query = assertValid(listMyRequestsSchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listRequests({ ...query, own: true }, req.auth),
  });
}

async function approveRequest(req, res) {
  const { requestId } = assertValid(requestIdParamsSchema, req.params);
  assertValid(emptyActionSchema, req.body);
  res.status(httpStatus.OK).json({ success: true, data: await service.approveRequest(requestId, req.auth) });
}

async function rejectRequest(req, res) {
  const { requestId } = assertValid(requestIdParamsSchema, req.params);
  const payload = assertValid(decisionSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.rejectRequest(requestId, payload, req.auth),
  });
}

async function cancelRequest(req, res) {
  const { requestId } = assertValid(requestIdParamsSchema, req.params);
  const payload = assertValid(cancelSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.cancelRequest(requestId, payload, req.auth),
  });
}

async function refundRequest(req, res) {
  const { requestId } = assertValid(requestIdParamsSchema, req.params);
  const payload = assertValid(refundSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.refundRequest(requestId, payload, req.auth),
  });
}

module.exports = {
  accrueBalances,
  adjustBalance,
  approveRequest,
  attachReferences,
  cancelRequest,
  carryOverBalances,
  createRequest,
  getBalance,
  getMyBalances,
  listMyRequests,
  listRequests,
  previewRequest,
  rejectRequest,
  refundRequest,
  resetBalances,
  upsertBalance,
  updateRequest,
};
