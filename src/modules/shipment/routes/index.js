const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/shipment.controller');
const { shipmentPermissions } = require('../constants/shipment.constants');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(shipmentPermissions.READ);
const requireWrite = authPublic.authorizeAnyPermission(shipmentPermissions.WRITE);
const requireWebhookLogRead = authPublic.authorizeAnyPermission(
  shipmentPermissions.READ,
  shipmentPermissions.WRITE,
);

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'shipment', status: 'ok' });
});

router.get(
  '/',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listShipments),
);

router.get(
  '/export.csv',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.exportShipmentsCsv),
);

router.get(
  '/summary',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.summarizeShipments),
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
  requireWebhookLogRead,
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

router.post(
  '/vendor-tracking/recheck',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.recheckVendorTracking),
);

router.post(
  '/vendor-tracking/recheck-submitted',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.recheckSubmittedVendorTracking),
);

router.post(
  '/:id/recheck',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.recheckShipment),
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
