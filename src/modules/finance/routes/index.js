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
const adsShopMappingController = require('../controllers/adsShopMapping.controller');
const adsUnassignedRowController = require('../controllers/adsUnassignedRow.controller');
const { financePermissions } = require('../constants/finance.constants');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission(financePermissions.READ, financePermissions.WRITE);
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
  fileFilter(req, file, cb) {
    cb(null, ['.csv', '.txt'].includes(path.extname(file.originalname || '').toLowerCase()));
  },
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

router.get(
  '/imports/settlements/:referenceId/completed',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(importController.hasCompletedSettlementImport),
);

router.post(
  '/imports/ads',
  authPublic.authenticate,
  requireWrite,
  upload.single('file'),
  asyncHandler(importController.importAds),
);
router.post('/refunds/:refundId/allocations', authPublic.authenticate, requireWrite, asyncHandler(importController.allocateRefund));
router.get('/refunds/unallocated', authPublic.authenticate, requireRead, asyncHandler(importController.listUnallocatedRefunds));
router.get('/refunds/reviews', authPublic.authenticate, requireRead, asyncHandler(importController.listRefundReviews));
router.post('/refunds/order-items/:orderItemId/confirm', authPublic.authenticate, requireWrite, asyncHandler(importController.confirmRefund));

router.get(
  '/settlements',
  authPublic.authenticate,
  requireRead,
  asyncHandler(importController.listSettlements),
);

router.get(
  '/settlements/:settlementId',
  authPublic.authenticate,
  requireRead,
  asyncHandler(importController.getSettlement),
);

router.post(
  '/settlements/:settlementId/reconcile',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(importController.reconcileSettlement),
);

router.get(
  '/ads-shop-mappings',
  authPublic.authenticate,
  requireRead,
  asyncHandler(adsShopMappingController.list),
);

router.put(
  '/ads-shop-mappings',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(adsShopMappingController.upsert),
);


router.get(
  '/ads-unassigned-rows',
  authPublic.authenticate,
  requireRead,
  asyncHandler(adsUnassignedRowController.list),
);

router.get(
  '/import-batches',
  authPublic.authenticate,
  requireRead,
  asyncHandler(importController.listImportBatches),
);

router.get(
  '/import-batches/:batchId',
  authPublic.authenticate,
  requireRead,
  asyncHandler(importController.getImportBatch),
);

router.post(
  '/import-batches/:batchId/reprocess',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(importController.reprocessImportBatch),
);

router.get(
  '/imported-data/:sourceType',
  authPublic.authenticate,
  requireRead,
  asyncHandler(importController.listImportedData),
);

router.get(
  '/filter-options',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listFilterOptions),
);

router.get(
  '/snapshots',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.listSnapshots),
);

router.get(
  '/snapshots/export.csv',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.exportSnapshotsCsv),
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

router.post(
  '/orders/:orderId/recalculate',
  authPublic.authenticate,
  requireWrite,
  asyncHandler(controller.recalculateOrder),
);

router.get(
  '/orders/:orderId/summary',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.getOrderSummary),
);

module.exports = router;
