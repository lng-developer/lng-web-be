const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/shipment.service');
const {
  listShipmentsQuerySchema,
  updateStatusSchema,
  updateTrackingSchema,
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

module.exports = {
  createFromVendorSubmission,
  getShipment,
  getShipmentByOrderItem,
  listShipments,
  updateStatus,
  updateTracking,
};
