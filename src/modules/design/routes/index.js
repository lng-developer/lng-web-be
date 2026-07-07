const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/designTask.controller');
const { designPermissions } = require('../constants/design.constants');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(designPermissions.READ);
const requireWrite = authPublic.authorizeAnyPermission(designPermissions.WRITE);

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'design', status: 'ok' });
});

router.get(
  '/tasks',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listTasks),
);

router.post(
  '/tasks',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.createTask),
);

router.get(
  '/tasks/:taskId',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getTask),
);

router.patch(
  '/tasks/:taskId/assign',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.assignTask),
);

router.patch(
  '/tasks/:taskId/start',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.startTask),
);

router.patch(
  '/tasks/:taskId/submit',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.submitTask),
);

router.patch(
  '/tasks/:taskId/approve',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.approveTask),
);

router.patch(
  '/tasks/:taskId/reject',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.rejectTask),
);

router.patch(
  '/tasks/:taskId/cancel',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.cancelTask),
);

module.exports = router;
