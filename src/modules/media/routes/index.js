const express = require('express');
const multer = require('multer');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/mediaAsset.controller');

const router = express.Router();
const requireMediaWrite = authPublic.authorizeAnyPermission('MEDIA:WRITE');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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

module.exports = router;
