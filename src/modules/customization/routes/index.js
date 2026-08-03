const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/customizationPayload.controller');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission('ORDERS:READ');
const requireWrite = authPublic.authorizeAnyPermission('ORDERS:WRITE');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'customization', status: 'ok' });
});

router.get('/', authPublic.authenticate, requireRead, asyncHandler(controller.listPayloads));
router.get('/summary', authPublic.authenticate, requireRead, asyncHandler(controller.summarizePayloads));
router.get('/order-items/:orderItemId', authPublic.authenticate, requireRead, asyncHandler(controller.getByOrderItem));
router.post('/order-items/:orderItemId/download-assets', authPublic.authenticate, requireWrite, asyncHandler(controller.downloadAssetsForOrderItem));
router.post('/order-items/:orderItemId/inspect-zip', authPublic.authenticate, requireWrite, asyncHandler(controller.inspectZipForOrderItem));
router.post('/order-items/:orderItemId/extract-zip-images', authPublic.authenticate, requireWrite, asyncHandler(controller.extractZipImagesForOrderItem));
router.get('/:payloadId', authPublic.authenticate, requireRead, asyncHandler(controller.getById));
router.post('/pending', authPublic.authenticate, requireWrite, asyncHandler(controller.createPendingPayload));
router.patch('/:payloadId/needs-review', authPublic.authenticate, requireWrite, asyncHandler(controller.markNeedsReview));
router.patch('/:payloadId/failed', authPublic.authenticate, requireWrite, asyncHandler(controller.markFailed));
router.patch('/:payloadId/parsed', authPublic.authenticate, requireWrite, asyncHandler(controller.markParsed));
router.post('/:payloadId/retry', authPublic.authenticate, requireWrite, asyncHandler(controller.retryPayload));

module.exports = router;
