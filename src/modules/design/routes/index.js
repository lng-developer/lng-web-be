const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/designTask.controller');
const { designPermissions } = require('../constants/design.constants');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(
  designPermissions.READ,
  designPermissions.WRITE,
  designPermissions.WORK,
  designPermissions.REVIEW,
);
const requireWrite = authPublic.authorizeAnyPermission(designPermissions.WRITE);
const requireWork = authPublic.authorizeAnyPermission(designPermissions.WRITE, designPermissions.WORK);
const requireReview = authPublic.authorizeAnyPermission(designPermissions.WRITE, designPermissions.REVIEW);

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'design', status: 'ok' });
});

router.get(
  '/assignees',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getAssignees),
);

router.get(
  '/tasks',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listTasks),
);

router.get(
  '/tasks/workload',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getWorkload),
);

router.post(
  '/tasks',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.createTask),
);

router.post(
  '/tasks/from-listings/:listingId/psd-template',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.createPsdTemplateTaskFromListing),
);

router.post(
  '/tasks/bulk-create-psd-from-listings',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.bulkCreatePsdTasksFromListings),
);

router.get(
  '/tasks/psd-template/candidates',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listPsdTemplateCandidates),
);

router.get(
  '/tasks/:taskId',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getTask),
);

router.get(
  '/tasks/:taskId/submissions',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listSubmissions),
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
  requireWork,
  asyncHandler(controller.startTask),
);

router.patch(
  '/tasks/:taskId/submit',
  authPublic.authenticate,
  requireWork,
  asyncHandler(controller.submitTask),
);

router.patch(
  '/tasks/:taskId/approve',
  authPublic.authenticate,
  requireReview,
  asyncHandler(controller.approveTask),
);

router.patch(
  '/tasks/:taskId/reject',
  authPublic.authenticate,
  requireReview,
  asyncHandler(controller.rejectTask),
);

router.patch(
  '/tasks/:taskId/cancel',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.cancelTask),
);

router.delete(
  '/tasks/:taskId/submissions/:submissionId',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.removeSubmission),
);

module.exports = router;
