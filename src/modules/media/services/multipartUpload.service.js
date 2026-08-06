const crypto = require('crypto');
const path = require('path');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const config = require('../../../config');
const repository = require('../repositories/mediaAsset.repository');
const wasabi = require('./wasabiStorage.service');

const ALLOWED_EXTENSIONS = new Set(['.psd', '.zip']);
const ALLOWED_PURPOSES = new Set(['PSD_TEMPLATE', 'DESIGN_PACKAGE', 'PRINT_READY']);

function fail(message, statusCode, code) {
  throw new AppError(message, statusCode, true, code);
}

function validateInitiate({ filename, size, assetPurpose }) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_PURPOSES.has(assetPurpose)) {
    fail('File type is not allowed', httpStatus.BAD_REQUEST, 'MEDIA_FILE_TYPE_INVALID');
  }
  if (!Number.isInteger(size) || size <= 0 || size > config.media.wasabi.maxAssetBytes) {
    fail('File is too large', httpStatus.BAD_REQUEST, 'MEDIA_FILE_TOO_LARGE');
  }
  return extension;
}

function objectKey(extension) {
  const now = new Date();
  return `media/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}${extension}`;
}

async function initiateUpload(input, auth = {}) {
  const extension = validateInitiate(input);
  if (!auth.accountId) fail('Unauthorized', httpStatus.UNAUTHORIZED, 'AUTHENTICATION_ERROR');
  const key = objectKey(extension);
  const { uploadId } = await wasabi.createMultipartUpload({ key, contentType: input.mimeType });
  const partSize = config.media.wasabi.partBytes;
  const totalParts = Math.ceil(input.size / partSize);
  const asset = await repository.create({
    originalFilename: input.filename,
    storageFilename: key,
    mimeType: input.mimeType || 'application/octet-stream',
    size: input.size,
    sha256: null,
    relativeStoragePath: key,
    provider: 'wasabi',
    providerAssetId: key,
    resourceType: 'raw',
    assetPurpose: input.assetPurpose,
    uploadStatus: 'UPLOADING',
    metadata: {
      uploadedBy: String(auth.accountId),
      multipartUploadId: uploadId,
      expectedSize: input.size,
      partSize,
      totalParts,
      expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)),
    },
  });
  return { assetId: String(asset._id || asset.id), partSize, totalParts };
}

function assertOwnedActiveUpload(asset, auth) {
  if (!asset) fail('Media asset not found', httpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND');
  if (String(asset.metadata?.uploadedBy || '') !== String(auth?.accountId || '')) {
    fail('Forbidden', httpStatus.FORBIDDEN, 'AUTHORIZATION_ERROR');
  }
  if (asset.uploadStatus !== 'UPLOADING') fail('Upload is not active', httpStatus.CONFLICT, 'MEDIA_UPLOAD_INCOMPLETE');
  if (new Date(asset.metadata?.expiresAt).getTime() <= Date.now()) {
    fail('Upload expired', httpStatus.CONFLICT, 'MEDIA_UPLOAD_EXPIRED');
  }
}

async function presignParts(assetId, partNumbers, auth) {
  const asset = await repository.findById(assetId);
  assertOwnedActiveUpload(asset, auth);
  const unique = [...new Set(partNumbers)];
  if (!unique.length || unique.length > 20 || unique.some((part) => (
    !Number.isInteger(part) || part < 1 || part > asset.metadata.totalParts
  ))) fail('Invalid part numbers', httpStatus.BAD_REQUEST, 'VALIDATION_ERROR');
  return Promise.all(unique.map(async (partNumber) => ({
    partNumber,
    url: await wasabi.presignUploadPart({
      key: asset.providerAssetId,
      uploadId: asset.metadata.multipartUploadId,
      partNumber,
      expiresIn: config.media.wasabi.uploadUrlTtlSeconds,
    }),
  })));
}

module.exports = { initiateUpload, presignParts };
