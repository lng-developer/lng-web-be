const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/financeSnapshot.controller');
const importController = require('../controllers/financeImport.controller');
const { financePermissions } = require('../constants/finance.constants');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(financePermissions.READ);
const requireWrite = authPublic.authorizeAnyPermission(financePermissions.WRITE);
const uploadDir = path.join(os.tmpdir(), 'lng-finance-imports');
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdir(uploadDir, { recursive: true }, (error) => cb(error, uploadDir));
    },
    filename(req, file, cb) {
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '')}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'finance', status: 'ok' });
});

router.post(
  '/imports/transactions',
  authPublic.authenticate,
  requireWrite,
  upload.single('file'),
  asyncHandler(importController.importTransactions),
);

router.post(
  '/imports/settlements',
  authPublic.authenticate,
  requireWrite,
  upload.single('file'),
  asyncHandler(importController.importSettlements),
);

router.post(
  '/imports/ads',
  authPublic.authenticate,
  requireWrite,
  upload.single('file'),
  asyncHandler(importController.importAds),
);

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
