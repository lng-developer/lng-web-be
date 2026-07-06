const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/vendorSubmission.service');
const {
  cancelSchema,
  listSubmissionsQuerySchema,
  markFailedSchema,
} = require('../validators/vendorSubmission.validator');
const { assertValid } = require('./requestValidation');

async function listSubmissions(req, res) {
  const query = assertValid(listSubmissionsQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listSubmissions(query, req.auth),
  });
}

async function getSubmission(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getSubmission(req.params.id, req.auth),
  });
}

async function createFromProductionTask(req, res) {
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createFromProductionTask(req.params.productionTaskId, req.auth),
  });
}

async function getPayloadPreview(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getPayloadPreview(req.params.id, req.auth),
  });
}

async function markSubmitted(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.markSubmitted(req.params.id, req.auth),
  });
}

async function markFailed(req, res) {
  const payload = assertValid(markFailedSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.markFailed(req.params.id, payload, req.auth),
  });
}

async function cancel(req, res) {
  const payload = assertValid(cancelSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.cancel(req.params.id, payload, req.auth),
  });
}

module.exports = {
  cancel,
  createFromProductionTask,
  getPayloadPreview,
  getSubmission,
  listSubmissions,
  markFailed,
  markSubmitted,
};
