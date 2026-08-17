const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/vendorSubmission.service');
const {
  cancelSchema,
  exportSubmissionsQuerySchema,
  listSubmissionsQuerySchema,
  markFailedSchema,
  reconcileSchema,
  recheckReadyProductionTasksSchema,
  retrySchema,
  summaryQuerySchema,
  submitToVendorSchema,
} = require('../validators/vendorSubmission.validator');
const { assertValid } = require('./requestValidation');

function auditAuth(req) {
  return {
    ...req.auth,
    source: 'HTTP',
    auditContext: {
      requestId: req.id ? String(req.id).slice(0, 200) : null,
      ipAddress: req.ip ? String(req.ip).slice(0, 100) : null,
      userAgent: req.get?.('user-agent') ? String(req.get('user-agent')).slice(0, 500) : null,
    },
  };
}

async function listSubmissions(req, res) {
  const query = assertValid(listSubmissionsQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listSubmissions(query, req.auth),
  });
}

async function exportSubmissionsCsv(req, res) {
  const query = assertValid(exportSubmissionsQuerySchema, req.query);
  const csv = await service.exportSubmissionsCsv(query, req.auth);
  res
    .status(httpStatus.OK)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', 'attachment; filename="vendor-submissions.csv"')
    .send(csv);
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
    data: await service.createFromProductionTask(req.params.productionTaskId, auditAuth(req)),
  });
}

async function recheckProductionTask(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckProductionTask(req.params.productionTaskId, auditAuth(req)),
  });
}

async function recheckReadyProductionTasks(req, res) {
  const query = assertValid(recheckReadyProductionTasksSchema, { ...req.query, ...req.body });
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckReadyProductionTasks(query, auditAuth(req)),
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
    data: await service.markSubmitted(req.params.id, auditAuth(req)),
  });
}

async function markFailed(req, res) {
  const payload = assertValid(markFailedSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.markFailed(req.params.id, payload, auditAuth(req)),
  });
}

async function cancel(req, res) {
  const payload = assertValid(cancelSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.cancel(req.params.id, payload, auditAuth(req)),
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
    data: await service.retry(req.params.id, payload, auditAuth(req)),
  });
}

async function submitToVendor(req, res) {
  const payload = assertValid(submitToVendorSchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.submitToVendor(req.params.id, payload, auditAuth(req)),
  });
}

async function reconcile(req, res) {
  const payload = assertValid(reconcileSchema, req.body || {});
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.reconcile(req.params.id, payload, auditAuth(req)),
  });
}

module.exports = {
  cancel,
  createFromProductionTask,
  exportSubmissionsCsv,
  getPayloadPreview,
  getSubmission,
  listSubmissions,
  markFailed,
  markSubmitted,
  recheckProductionTask,
  recheckReadyProductionTasks,
  reconcile,
  retry,
  submitToVendor,
  summarizeSubmissions,
};
