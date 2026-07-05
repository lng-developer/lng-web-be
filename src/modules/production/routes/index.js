const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/productionTask.controller');

const router = express.Router();
const requireProductionRead = authPublic.authorizeAnyPermission('PRODUCTION:READ');
const requireProductionWrite = authPublic.authorizeAnyPermission('PRODUCTION:WRITE');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'production', status: 'ok' });
});

router.get(
  '/tasks',
  authPublic.authenticate,
  requireProductionRead,
  asyncHandler(controller.listTasks),
);

router.get(
  '/tasks/summary',
  authPublic.authenticate,
  requireProductionRead,
  asyncHandler(controller.summarizeTasks),
);

router.patch(
  '/tasks/bulk-assign',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.bulkAssignDesignTasks),
);

router.patch(
  '/tasks/:taskId/assign',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.assignDesignTask),
);

router.patch(
  '/tasks/:taskId/claim',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.claimDesignTask),
);

router.patch(
  '/tasks/:taskId/design-note',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.updateDesignNote),
);

router.get(
  '/order-items/:orderItemId/task',
  authPublic.authenticate,
  requireProductionRead,
  asyncHandler(controller.getTaskByOrderItem),
);

router.post(
  '/order-items/:orderItemId/recheck',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.recheckTask),
);

router.patch(
  '/tasks/:taskId/file-checks/:fileCheckId/scaled-output',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.uploadScaledFile),
);

router.patch(
  '/tasks/:taskId/qc',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.submitQc),
);

router.patch(
  '/tasks/:taskId/sent-to-vendor',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.markSentToVendor),
);

module.exports = router;
