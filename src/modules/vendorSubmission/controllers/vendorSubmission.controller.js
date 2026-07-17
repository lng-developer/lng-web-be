const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/vendorSubmission.service');
const {
  cancelSchema,
  listSubmissionsQuerySchema,
  markFailedSchema,
  recheckReadyProductionTasksSchema,
  retrySchema,
  summaryQuerySchema,
  submitToVendorSchema,
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

async function recheckProductionTask(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckProductionTask(req.params.productionTaskId, req.auth),
  });
}

async function recheckReadyProductionTasks(req, res) {
  const query = assertValid(recheckReadyProductionTasksSchema, { ...req.query, ...req.body });
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckReadyProductionTasks(query, req.auth),
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

async function summarizeSubmissions(req, res) {
  const query = assertValid(summaryQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.summarizeSubmissions(query, req.auth),
  });
}

async function retry(req, res) {
  const payload = assertValid(retrySchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.retry(req.params.id, payload, req.auth),
  });
}

async function submitToVendor(req, res) {
  const payload = assertValid(submitToVendorSchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.submitToVendor(req.params.id, payload, req.auth),
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
  recheckProductionTask,
  recheckReadyProductionTasks,
  retry,
  submitToVendor,
  summarizeSubmissions,
};
