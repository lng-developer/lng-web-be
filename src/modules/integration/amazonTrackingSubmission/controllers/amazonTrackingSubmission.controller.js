const AppError = require('../../../../shared/errors/appError');
const httpStatus = require('../../../../shared/constants/httpStatus');
const errorCodes = require('../../../../shared/constants/errorCodes');
const {
  createSubmissionSchema,
  listSubmissionsQuerySchema,
  leasePayloadBodySchema,
  recordBatchBodySchema,
  terminalBodySchema,
} = require('../validators/amazonTrackingSubmission.validator');
const service = require('../services/amazonTrackingSubmission.service');

function assertValid(schema, payload) {
  const { error, value } = schema.validate(payload, { abortEarly: false, stripUnknown: true });
  if (error) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, error.details);
  }
  return value;
}

async function createSubmission(req, res) {
  const payload = assertValid(createSubmissionSchema, req.body);
  const data = await service.createSubmission(payload, req.auth);
  res.status(httpStatus.CREATED).json({ success: true, data });
}

async function listSubmissions(req, res) {
  const query = assertValid(listSubmissionsQuerySchema, req.query);
  const data = await service.listSubmissions(query, req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

async function getSubmission(req, res) {
  const data = await service.getSubmission(req.params.submissionId, req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

// Agent callbacks
async function getLeasedPayload(req, res) {
  const body = assertValid(leasePayloadBodySchema, req.body);
  const data = await service.getLeasedPayload(req.params.commandId, body, req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

async function markSubmitted(req, res) {
  const body = assertValid(leasePayloadBodySchema, req.body);
  const data = await service.markSubmitted(req.params.commandId, req.params.submissionId, body, req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

async function markWaiting(req, res) {
  const body = assertValid(leasePayloadBodySchema, req.body);
  const data = await service.markWaiting(req.params.commandId, req.params.submissionId, body, req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

async function recordAmazonBatch(req, res) {
  const body = assertValid(recordBatchBodySchema, req.body);
  const data = await service.recordAmazonBatch(req.params.commandId, req.params.submissionId, body, req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

async function markTerminal(req, res) {
  const body = assertValid(terminalBodySchema, req.body);
  const data = await service.markTerminal(req.params.commandId, req.params.submissionId, body, req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

module.exports = {
  createSubmission,
  listSubmissions,
  getSubmission,
  getLeasedPayload,
  markSubmitted,
  markWaiting,
  recordAmazonBatch,
  markTerminal,
};
