const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/financeSnapshot.controller');
const { financePermissions } = require('../constants/finance.constants');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(financePermissions.READ);
const requireWrite = authPublic.authorizeAnyPermission(financePermissions.WRITE);

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'finance', status: 'ok' });
});

router.get(
  '/snapshots',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listSnapshots),
);

router.get(
  '/order-items/:orderItemId/snapshot',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getSnapshotByOrderItem),
);

router.post(
  '/order-items/:orderItemId/recalculate',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.recalculateOrderItem),
);

router.get(
  '/orders/:orderId/summary',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getOrderSummary),
);

module.exports = router;
