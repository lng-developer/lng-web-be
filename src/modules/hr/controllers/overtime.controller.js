const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/overtime.service');
const {
  approveSchema,
  cancelSchema,
  createRequestSchema,
  decisionSchema,
  listMyRequestsSchema,
  listRequestsSchema,
  requestIdParamsSchema,
  validate,
} = require('../validators/overtime.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
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
  const payload = assertValid(approveSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.approveRequest(requestId, payload, req.auth),
  });
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

module.exports = { approveRequest, cancelRequest, createRequest, listMyRequests, listRequests, rejectRequest, updateRequest };
