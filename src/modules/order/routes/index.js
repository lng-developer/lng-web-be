const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const orderController = require('../controllers/order.controller');

const router = express.Router();
const requireOrderRead = authPublic.authorizeAnyPermission('ORDERS:READ');
const requireOrderWrite = authPublic.authorizeAnyPermission('ORDERS:WRITE');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'order', status: 'ok' });
});

router.get(
  '/',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(orderController.listOrders),
);
router.get(
  '/summary',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(orderController.getOrderSummary),
);
router.get(
  '/items/:orderItemId/timeline',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(orderController.listOrderItemTimeline),
);
router.get(
  '/items/:orderItemId/readiness',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(orderController.getOrderItemReadiness),
);
router.post(
  '/items/:orderItemId/mark-fulfillment-ready',
  authPublic.authenticate,
  requireOrderWrite,
  asyncHandler(orderController.markFulfillmentReady),
);
router.get(
  '/items/:orderItemId',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(orderController.getOrderItem),
);
router.get(
  '/:orderId/timeline',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(orderController.listOrderTimeline),
);
router.get(
  '/:orderId/expanded',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(orderController.getExpandedOrder),
);
router.get(
  '/:orderId/items',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(orderController.listOrderItems),
);
router.patch(
  '/:orderId/shipping-address',
  authPublic.authenticate,
  requireOrderWrite,
  asyncHandler(orderController.updateShippingAddress),
);
router.post(
  '/:orderId/validate-address',
  authPublic.authenticate,
  requireOrderWrite,
  asyncHandler(orderController.validateAddress),
);
router.patch(
  '/:orderId/assigned-staff',
  authPublic.authenticate,
  requireOrderWrite,
  asyncHandler(orderController.assignStaff),
);
router.get(
  '/:orderId',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(orderController.getOrder),
);

module.exports = router;
