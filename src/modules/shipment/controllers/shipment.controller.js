const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/shipment.service');
const webhookService = require('../services/shipmentWebhook.service');
const {
  listWebhookLogsQuerySchema,
  listShipmentsQuerySchema,
  summaryQuerySchema,
  updateStatusSchema,
  updateTrackingSchema,
  vendorTrackingBatchRecheckSchema,
  vendorTrackingRecheckSchema,
} = require('../validators/shipment.validator');
const { assertValid } = require('./requestValidation');

async function listShipments(req, res) {
  const query = assertValid(listShipmentsQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.listShipments(query, req.auth),
  });
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
    data: await service.createFromVendorSubmission(req.params.vendorSubmissionId, req.auth),
  });
}

async function updateTracking(req, res) {
  const payload = assertValid(updateTrackingSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateTracking(req.params.id, payload, req.auth),
  });
}

async function updateStatus(req, res) {
  const payload = assertValid(updateStatusSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.updateStatus(req.params.id, payload, req.auth),
  });
}

async function recheckVendorTracking(req, res) {
  const payload = assertValid(vendorTrackingRecheckSchema, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckVendorTracking(payload, req.auth),
  });
}

async function recheckSubmittedVendorTracking(req, res) {
  const payload = assertValid(vendorTrackingBatchRecheckSchema, req.body);
  if (payload.limit) payload.limit = Math.min(payload.limit, 100);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.recheckSubmittedVendorTracking(payload, req.auth),
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
  getShipment,
  getShipmentByOrderItem,
  listVendorWebhookLogs,
  listShipments,
  recheckSubmittedVendorTracking,
  recheckVendorTracking,
  receiveVendorWebhook,
  summarizeShipments,
  updateStatus,
  updateTracking,
  verifyVendorWebhook,
};
