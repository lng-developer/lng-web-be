const fs = require('fs');
const path = require('path');
const AppError = require('../../shared/errors/appError');
const errorCodes = require('../../shared/constants/errorCodes');
const httpStatus = require('../../shared/constants/httpStatus');
const mediaAssetService = require('./services/mediaAsset.service');

const allowedImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const allowedDocumentExtensions = new Set(['.psd', '.pdf', '.zip', '.rar']);
const allowedExactMimeTypes = new Set([
  'application/pdf', 'application/vnd.rar', 'application/zip', 'application/x-rar-compressed',
  'application/x-zip', 'application/x-zip-compressed', 'image/vnd.adobe.photoshop',
  'application/x-photoshop', 'application/octet-stream',
]);

function isAllowedUpload(file = {}) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const mimeType = String(file.mimetype || '').toLowerCase();
  return (mimeType.startsWith('image/') && allowedImageExtensions.has(extension))
    || (allowedDocumentExtensions.has(extension) && allowedExactMimeTypes.has(mimeType));
}

async function storeUploadedFile(file, metadata = {}) {
  if (!file) throw new AppError('file is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  try {
    if (!isAllowedUpload(file)) {
      throw new AppError('file type is not allowed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
    }
    return await mediaAssetService.storeAsset({
      stream: fs.createReadStream(file.path), filename: file.originalname,
      mimeType: file.mimetype || null, metadata, maxBytes: file.size,
    });
  } finally {
    if (file.path) await fs.promises.rm(file.path, { force: true, maxRetries: 3, retryDelay: 50 });
  }
}

const publicPort = {
  discardUnattachedAsset: mediaAssetService.discardUnattachedAsset,
  findAssetIdsByOriginalFilename: mediaAssetService.findAssetIdsByOriginalFilename,
  getAsset: mediaAssetService.getAsset,
  getAssetsByIds: mediaAssetService.getAssetsByIds,
  getStorageProvider: mediaAssetService.getStorageProvider,
  readAssetBuffer: mediaAssetService.readAssetBuffer,
  storeAsset: mediaAssetService.storeAsset,
  storeUploadedFile,
  withAssetLocalReadFile: mediaAssetService.withAssetLocalReadFile,
  assertMediaAssetExists: mediaAssetService.assertMediaAssetExists,
};

module.exports = publicPort;
