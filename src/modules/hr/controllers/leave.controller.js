const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/leave.service');
const {
  balanceParamsSchema,
  balanceYearQuerySchema,
  createRequestSchema,
  decisionSchema,
  emptyActionSchema,
  listMyRequestsSchema,
  listRequestsSchema,
  requestIdParamsSchema,
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
  const payload = assertValid(decisionSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.cancelRequest(requestId, payload, req.auth),
  });
}

module.exports = {
  approveRequest,
  cancelRequest,
  createRequest,
  getBalance,
  getMyBalances,
  listMyRequests,
  listRequests,
  rejectRequest,
  upsertBalance,
};
