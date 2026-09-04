const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');
const config = require('../../../config');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/productionTask.controller');

const router = express.Router();
const uploadDir = path.join(os.tmpdir(), 'lng-production-uploads');
const maxUploadBytes = config.media.uploadMaxBytes;
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdir(uploadDir, { recursive: true }, (error) => cb(error, uploadDir));
    },
    filename(req, file, cb) {
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '')}`);
    },
  }),
  limits: { fileSize: maxUploadBytes },
});
const requireProductionRead = authPublic.authorizeAnyPermission(
  'PRODUCTION:READ',
  'PRODUCTION:WRITE',
  'DESIGN:WORK',
  'DESIGN:REVIEW',
);
const requireProductionWrite = authPublic.authorizeAnyPermission('PRODUCTION:WRITE');
const requireDesignAssign = authPublic.authorizeAnyPermission('PRODUCTION:WRITE', 'DESIGN:REVIEW');
const requireScaleWork = authPublic.authorizeAnyPermission('PRODUCTION:WRITE', 'DESIGN:WORK');
const requireQcReview = authPublic.authorizeAnyPermission('PRODUCTION:WRITE', 'DESIGN:REVIEW');

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

router.get(
  '/tasks/queue-summary',
  authPublic.authenticate,
  requireProductionRead,
  asyncHandler(controller.summarizeQueueCounts),
);

router.get(
  '/tasks/scale-assignees',
  authPublic.authenticate,
  requireProductionRead,
  asyncHandler(controller.getScaleAssignees),
);

router.get(
  '/tasks/cs-assignees',
  authPublic.authenticate,
  requireProductionRead,
  asyncHandler(controller.getCsAssignees),
);

router.patch(
  '/tasks/bulk-assign',
  authPublic.authenticate,
  requireDesignAssign,
  asyncHandler(controller.bulkAssignDesignTasks),
);

router.post(
  '/tasks/bulk-push-vendor',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.bulkPushVendor),
);

router.get(
  '/tasks/qc/export',
  authPublic.authenticate,
  requireProductionRead,
  asyncHandler(controller.exportQcTasks),
);

router.get(
  '/tasks/export.csv',
  authPublic.authenticate,
  requireProductionRead,
  asyncHandler(controller.exportTasksCsv),
);

router.post(
  '/tasks/recheck-psd-blocked',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.recheckPsdBlockedTasks),
);

router.get(
  '/tasks/:taskId',
  authPublic.authenticate,
  requireProductionRead,
  asyncHandler(controller.getTaskById),
);

router.patch(
  '/tasks/:taskId/assign',
  authPublic.authenticate,
  requireDesignAssign,
  asyncHandler(controller.assignDesignTask),
);

router.patch(
  '/tasks/:taskId/assign-cs',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.assignCsTask),
);

router.patch(
  '/tasks/:taskId/claim',
  authPublic.authenticate,
  requireScaleWork,
  asyncHandler(controller.claimDesignTask),
);

router.patch(
  '/tasks/:taskId/design-note',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.updateDesignNote),
);

router.patch(
  '/tasks/:taskId/cs-note',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.updateCsNote),
);

router.patch(
  '/tasks/:taskId/cs-status',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.updateCsStatus),
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

router.post(
  '/tasks/:taskId/file-checks/manual',
  authPublic.authenticate,
  requireScaleWork,
  asyncHandler(controller.addManualFileCheck),
);

router.post(
  '/tasks/:taskId/file-checks/manual/scaled-output-file',
  authPublic.authenticate,
  requireScaleWork,
  upload.single('file'),
  asyncHandler(controller.addManualScaledOutputFile),
);

router.patch(
  '/tasks/:taskId/file-checks/:fileCheckId/scaled-output',
  authPublic.authenticate,
  requireScaleWork,
  asyncHandler(controller.uploadScaledFile),
);

router.post(
  '/tasks/:taskId/file-checks/:fileCheckId/scaled-output-file',
  authPublic.authenticate,
  requireScaleWork,
  upload.single('file'),
  asyncHandler(controller.uploadScaledOutputFile),
);

router.patch(
  '/tasks/:taskId/submit-scale-qc',
  authPublic.authenticate,
  requireScaleWork,
  asyncHandler(controller.submitScaleForQc),
);

router.patch(
  '/tasks/:taskId/qc',
  authPublic.authenticate,
  requireQcReview,
  asyncHandler(controller.submitQc),
);

router.patch(
  '/tasks/:taskId/sent-to-vendor',
  authPublic.authenticate,
  requireProductionWrite,
  asyncHandler(controller.markSentToVendor),
);

module.exports = router;
