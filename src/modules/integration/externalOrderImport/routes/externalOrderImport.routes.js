const express = require('express');
const multer = require('multer');
const asyncHandler = require('../../../../middlewares/asyncHandler');
const authPublic = require('../../../auth/public');
const controller = require('../controllers/externalOrderImport.controller');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const requireOrderRead = authPublic.authorizeAnyPermission('ORDERS:READ', 'ORDERS:WRITE');
const requireOrderWrite = authPublic.authorizeAnyPermission('ORDERS:WRITE');
const rawReportBody = express.raw({
  type: ['text/plain', 'text/csv', 'text/tab-separated-values', 'application/octet-stream'],
  limit: '10mb',
});

router.post(
  '/manual-excel',
  rawReportBody,
  authPublic.authenticate,
  requireOrderWrite,
  upload.single('file'),
  asyncHandler(controller.importManualExcel),
);

router.post(
  '/etsy-sold-order-items',
  rawReportBody,
  authPublic.authenticate,
  requireOrderWrite,
  upload.single('file'),
  asyncHandler(controller.importEtsySoldOrderItems),
);

router.get('/issues', authPublic.authenticate, requireOrderRead, asyncHandler(controller.listIssues));
router.post('/:jobId/retry', authPublic.authenticate, requireOrderWrite, asyncHandler(controller.retryImportJob));
router.get('/:jobId', authPublic.authenticate, requireOrderRead, asyncHandler(controller.getImportJob));
router.get('/:jobId/issues', authPublic.authenticate, requireOrderRead, asyncHandler(controller.listImportJobIssues));
router.get(
  '/:jobId/raw-records',
  authPublic.authenticate,
  requireOrderRead,
  asyncHandler(controller.listImportJobRawRecords),
);

module.exports = router;
