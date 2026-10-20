const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');
const config = require('../../../config');
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
const requirePsdRequestRead = authPublic.authorizeAnyPermission(
  designPermissions.READ,
  designPermissions.WRITE,
  designPermissions.WORK,
  designPermissions.REVIEW,
  designPermissions.PSD_REQUEST,
);
const requirePsdRequestAction = authPublic.authorizeAnyPermission(
  designPermissions.WRITE,
  designPermissions.REVIEW,
  designPermissions.PSD_REQUEST,
);
const uploadDir = path.join(os.tmpdir(), 'lng-design-uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdir(uploadDir, { recursive: true }, (error) => cb(error, uploadDir));
    },
    filename(req, file, cb) {
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '')}`);
    },
  }),
  limits: { fileSize: config.media.uploadMaxBytes },
});

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'design', status: 'ok' });
});

router.post(
  '/assets',
  authPublic.authenticate,
  requireWork,
  upload.single('file'),
  asyncHandler(controller.uploadAsset),
);

router.get(
  '/assignees',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getAssignees),
);

router.get(
  '/score-summary',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.summarizeScores),
);

router.get(
  '/submission-scores',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listSubmissionScores),
);

router.get(
  '/psd-files',
  authPublic.authenticate,
  requirePsdRequestRead,
  asyncHandler(controller.listPsdFiles),
);

router.patch(
  '/submission-scores/:scoreId/override',
  authPublic.authenticate,
  requireReview,
  asyncHandler(controller.overrideSubmissionScore),
);

router.patch(
  '/tasks/:taskId/submissions/:submissionId/assets/:assetId/score/void',
  authPublic.authenticate,
  requireReview,
  asyncHandler(controller.voidSubmissionScore),
);

router.get(
  '/tasks',
  authPublic.authenticate,
  requirePsdRequestRead,
  asyncHandler(controller.listTasks),
);

router.get(
  '/tasks/export.csv',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.exportTasksCsv),
);

router.get(
  '/tasks/workload',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getWorkload),
);

router.get(
  '/tasks/summary',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.summarizeTasks),
);

router.post(
  '/tasks',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.createTask),
);

router.post(
  '/tasks/from-listings/:listingId/variants/:variantId/psd-template',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.createPsdTemplateTaskFromListingVariant),
);

router.patch(
  '/tasks/bulk-assign',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.bulkAssignTasks),
);

router.get(
  '/tasks/:taskId',
  authPublic.authenticate,
  requirePsdRequestRead,
  asyncHandler(controller.getTask),
);

router.get(
  '/tasks/:taskId/submissions',
  authPublic.authenticate,
  requirePsdRequestRead,
  asyncHandler(controller.listSubmissions),
);

router.patch(
  '/tasks/:taskId/assign',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.assignTask),
);

router.patch(
  '/tasks/:taskId/priority',
  authPublic.authenticate,
  requirePsdRequestAction,
  asyncHandler(controller.updateTaskPriority),
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
  requirePsdRequestAction,
  asyncHandler(controller.approveTask),
);

router.patch(
  '/tasks/:taskId/reject',
  authPublic.authenticate,
  requirePsdRequestAction,
  asyncHandler(controller.rejectTask),
);

router.patch(
  '/tasks/:taskId/reopen',
  authPublic.authenticate,
  requireReview,
  asyncHandler(controller.reopenTask),
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
