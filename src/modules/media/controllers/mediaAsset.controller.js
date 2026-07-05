const { Readable } = require('stream');
const path = require('path');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const service = require('../services/mediaAsset.service');
const { toMediaAssetDto } = require('../dtos/mediaAsset.dto');

function validationError(message, details) {
  throw new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
}

const allowedImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const allowedDocumentExtensions = new Set(['.psd', '.pdf', '.zip']);
const allowedExactMimeTypes = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip',
  'application/x-zip-compressed',
  'image/vnd.adobe.photoshop',
  'application/x-photoshop',
  'application/octet-stream',
]);

function isAllowedUpload(file = {}) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const mimeType = String(file.mimetype || '').toLowerCase();
  const imageByMime = mimeType.startsWith('image/') && allowedImageExtensions.has(extension);
  const documentByMime = allowedDocumentExtensions.has(extension) && allowedExactMimeTypes.has(mimeType);
  return imageByMime || documentByMime;
}

async function uploadAsset(req, res) {
  const file = req.file;
  if (!file) validationError('file is required', { field: 'file' });
  if (!isAllowedUpload(file)) {
    validationError('file type is not allowed', {
      field: 'file',
      mimeType: file.mimetype || null,
      extension: path.extname(file.originalname || '').toLowerCase() || null,
    });
  }

  const asset = await service.storeAsset({
    stream: Readable.from(file.buffer),
    filename: file.originalname,
    mimeType: file.mimetype || null,
    metadata: {
      source: 'MEDIA_UPLOAD',
      uploadedBy: req.auth?.accountId || null,
    },
    maxBytes: file.size,
  });

  res.status(httpStatus.CREATED).json({
    success: true,
    data: toMediaAssetDto(asset),
  });
}

async function getAsset(req, res) {
  assertValidObjectId(req.params.assetId, 'assetId');
  res.status(httpStatus.OK).json({
    success: true,
    data: toMediaAssetDto(await service.getAsset(req.params.assetId)),
  });
}

async function downloadAsset(req, res) {
  assertValidObjectId(req.params.assetId, 'assetId');
  const { asset, buffer } = await service.readAssetBuffer(req.params.assetId);
  const filename = encodeURIComponent(asset.originalFilename || 'asset.bin');
  res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.status(httpStatus.OK).send(buffer);
}

module.exports = {
  downloadAsset,
  getAsset,
  uploadAsset,
};
