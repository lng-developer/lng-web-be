const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/vendorSubmission.controller');
const { vendorSubmissionPermissions } = require('../constants/vendorSubmission.constants');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(vendorSubmissionPermissions.READ);
const requireWrite = authPublic.authorizeAnyPermission(vendorSubmissionPermissions.WRITE);

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'vendorSubmission', status: 'ok' });
});

router.get(
  '/',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listSubmissions),
);

router.post(
  '/from-production-tasks/:productionTaskId',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.createFromProductionTask),
);

router.get(
  '/:id/payload-preview',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getPayloadPreview),
);

router.post(
  '/:id/mark-submitted',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.markSubmitted),
);

router.post(
  '/:id/mark-failed',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.markFailed),
);

router.post(
  '/:id/cancel',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.cancel),
);

router.get(
  '/:id',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getSubmission),
);

module.exports = router;
