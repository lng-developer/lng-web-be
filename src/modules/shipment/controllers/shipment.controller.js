const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/shipment.service');
const trackingSyncConfigService = require('../services/trackingSyncConfig.service');
const trackingScheduler = require('../services/vendorTrackingRecheckScheduler.service');
const webhookService = require('../services/shipmentWebhook.service');
const {
  exportShipmentsQuerySchema,
  listWebhookLogsQuerySchema,
  listShipmentsQuerySchema,
  summaryQuerySchema,
  updateStatusSchema,
  updateTrackingSchema,
  trackingSyncConfigSchema,
  vendorTrackingBatchRecheckSchema,
  vendorTrackingRecheckSchema,
} = require('../validators/shipment.validator');
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

async function listShipments(req, res) {
  const query = assertValid(listShipmentsQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listShipments(query, req.auth),
  });
}

async function exportShipmentsCsv(req, res) {
  const query = assertValid(exportShipmentsQuerySchema, req.query);
  const csv = await service.exportShipmentsCsv(query, req.auth);
  res
    .status(httpStatus.OK)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', 'attachment; filename="shipments.csv"')
    .send(csv);
}

async function getShipment(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getShipment(req.params.id, req.auth),
  });
}

async function getShipmentByOrderItem(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getShipmentByOrderItem(req.params.orderItemId, req.auth),
  });
}

async function createFromVendorSubmission(req, res) {
  res.status(httpStatus.CREATED).json({
    success: true,
    data: await service.createFromVendorSubmission(req.params.vendorSubmissionId, auditAuth(req)),
  });
}

async function updateTracking(req, res) {
  const payload = assertValid(updateTrackingSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateTracking(req.params.id, payload, auditAuth(req)),
  });
}

async function updateStatus(req, res) {
  const payload = assertValid(updateStatusSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateStatus(req.params.id, payload, auditAuth(req)),
  });
}

async function recheckVendorTracking(req, res) {
  const payload = assertValid(vendorTrackingRecheckSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckVendorTracking(payload, auditAuth(req)),
  });
}

async function recheckShipment(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckShipment(req.params.id, auditAuth(req)),
  });
}

async function recheckSubmittedVendorTracking(req, res) {
  const payload = assertValid(vendorTrackingBatchRecheckSchema, req.body);
  if (payload.limit) payload.limit = Math.min(payload.limit, 100);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckSubmittedVendorTracking(payload, auditAuth(req)),
  });
}

async function getTrackingSyncConfig(req, res) {
  res.status(httpStatus.OK).json({ success: true, data: await trackingSyncConfigService.get() });
}

async function updateTrackingSyncConfig(req, res) {
  const payload = assertValid(trackingSyncConfigSchema, req.body);
  const config = await trackingSyncConfigService.update(payload, auditAuth(req));
  trackingScheduler.applyTrackingSyncConfig(config);
  res.status(httpStatus.OK).json({ success: true, data: config });
}

async function runTrackingSyncNow(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await trackingScheduler.runOnce({ ...auditAuth(req), system: false }),
  });
}

async function summarizeShipments(req, res) {
  const query = assertValid(summaryQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.summarizeShipments(query, req.auth),
  });
}

async function verifyVendorWebhook(req, res) {
  res.status(httpStatus.OK).json({
    success: true,
    data: await webhookService.verifyVendorWebhook(req.params.provider, req),
  });
}

async function receiveVendorWebhook(req, res) {
  const result = await webhookService.receiveVendorWebhook(req.params.provider, req);
  res.status(result.statusCode).json({
    success: true,
    data: result.data,
  });
}

async function listVendorWebhookLogs(req, res) {
  const query = assertValid(listWebhookLogsQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await webhookService.listWebhookLogs(query, req.auth),
  });
}

module.exports = {
  createFromVendorSubmission,
  exportShipmentsCsv,
  getShipment,
  getShipmentByOrderItem,
  listVendorWebhookLogs,
  listShipments,
  getTrackingSyncConfig,
  recheckSubmittedVendorTracking,
  recheckVendorTracking,
  recheckShipment,
  runTrackingSyncNow,
  receiveVendorWebhook,
  summarizeShipments,
  updateStatus,
  updateTrackingSyncConfig,
  updateTracking,
  verifyVendorWebhook,
};
