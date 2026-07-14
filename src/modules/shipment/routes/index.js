const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/shipment.controller');
const { shipmentPermissions } = require('../constants/shipment.constants');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(shipmentPermissions.READ);
const requireWrite = authPublic.authorizeAnyPermission(shipmentPermissions.WRITE);

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'shipment', status: 'ok' });
});

router.get(
  '/',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listShipments),
);

router.post(
  '/from-vendor-submissions/:vendorSubmissionId',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.createFromVendorSubmission),
);

router.get(
  '/vendor-webhooks/logs',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listVendorWebhookLogs),
);

router.get(
  '/vendor-webhooks/:provider',
  asyncHandler(controller.verifyVendorWebhook),
);

router.post(
  '/vendor-webhooks/:provider',
  asyncHandler(controller.receiveVendorWebhook),
);

router.get(
  '/order-items/:orderItemId',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getShipmentByOrderItem),
);

router.patch(
  '/:id/tracking',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.updateTracking),
);

router.patch(
  '/:id/status',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.updateStatus),
);

router.get(
  '/:id',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getShipment),
);

module.exports = router;
