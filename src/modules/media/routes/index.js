const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');
const config = require('../../../config');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/mediaAsset.controller');

const router = express.Router();
const requireMediaRead = authPublic.authorizeAnyPermission('MEDIA:READ');
const requireGlobalMediaRead = authPublic.authorizePermissions('MEDIA:READ');
const requireMediaWrite = authPublic.authorizeAnyPermission('MEDIA:WRITE');
const uploadDir = path.join(os.tmpdir(), 'lng-media-uploads');
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

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'media', status: 'ok' });
});

router.post(
  '/assets',
  authPublic.authenticate,
  requireMediaWrite,
  upload.single('file'),
  asyncHandler(controller.uploadAsset),
);

router.get(
  '/assets',
  authPublic.authenticate,
  requireGlobalMediaRead,
  asyncHandler(controller.listAssets),
);

router.get(
  '/assets/:assetId',
  authPublic.authenticate,
  requireMediaRead,
  asyncHandler(controller.getAsset),
);

router.get(
  '/assets/:assetId/download',
  authPublic.authenticate,
  requireMediaRead,
  asyncHandler(controller.downloadAsset),
);

module.exports = router;
