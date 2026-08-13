const crypto = require('crypto');
const path = require('path');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const config = require('../../../config');
const repository = require('../repositories/mediaAsset.repository');
const wasabi = require('./wasabiStorage.service');

const PACKAGE_EXTENSIONS = new Set(['.psd', '.zip']);
const ALLOWED_PURPOSES = new Set(['PSD_TEMPLATE', 'DESIGN_PACKAGE', 'PRINT_READY']);

function fail(message, statusCode, code) {
  throw new AppError(message, statusCode, true, code);
}

function validateInitiate({ filename, size, assetPurpose }) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (!ALLOWED_PURPOSES.has(assetPurpose) || !PACKAGE_EXTENSIONS.has(extension)) {
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

function assertOwned(asset, auth) {
  if (!asset) fail('Media asset not found', httpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND');
  if (String(asset.metadata?.uploadedBy || '') !== String(auth?.accountId || '')) {
    fail('Forbidden', httpStatus.FORBIDDEN, 'AUTHORIZATION_ERROR');
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

function validateCompletedParts(parts, totalParts) {
  if (!Array.isArray(parts) || parts.length !== totalParts) {
    fail('Upload is incomplete', httpStatus.CONFLICT, 'MEDIA_UPLOAD_INCOMPLETE');
  }
  const numbers = new Set();
  for (const part of parts) {
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > totalParts
      || typeof part.etag !== 'string' || !part.etag.trim() || numbers.has(part.partNumber)) {
      fail('Upload is incomplete', httpStatus.CONFLICT, 'MEDIA_UPLOAD_INCOMPLETE');
    }
    numbers.add(part.partNumber);
  }
}

function hasValidSignature(filename, bytes) {
  const extension = path.extname(filename || '').toLowerCase();
  if (extension === '.psd') return bytes.subarray(0, 4).equals(Buffer.from([0x38, 0x42, 0x50, 0x53]));
  if (extension === '.zip') {
    const signature = bytes.subarray(0, 4).toString('hex');
    return ['504b0304', '504b0506', '504b0708'].includes(signature);
  }
  if (['.jpg', '.jpeg', '.jfif'].includes(extension)) {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (extension === '.png') {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === '.webp') {
    return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

async function completeUpload(assetId, parts, auth) {
  const asset = await repository.findById(assetId);
  assertOwned(asset, auth);
  if (asset.uploadStatus === 'READY') return asset;
  assertOwnedActiveUpload(asset, auth);
  validateCompletedParts(parts, asset.metadata.totalParts);
  const verifying = await repository.transitionUploadStatus(assetId, 'UPLOADING', 'VERIFYING');
  if (!verifying) fail('Upload state changed', httpStatus.CONFLICT, 'MEDIA_UPLOAD_INCOMPLETE');
  try {
    await wasabi.completeMultipartUpload({
      key: asset.providerAssetId,
      uploadId: asset.metadata.multipartUploadId,
      parts,
    });
    const [head, signature] = await Promise.all([
      wasabi.headObject({ key: asset.providerAssetId }),
      wasabi.readObjectRange({ key: asset.providerAssetId, start: 0, end: 11 }),
    ]);
    if (Number(head.ContentLength) !== asset.size || !hasValidSignature(asset.originalFilename, signature)) {
      fail('Uploaded file verification failed', httpStatus.UNPROCESSABLE_ENTITY, 'MEDIA_FILE_TYPE_INVALID');
    }
    return repository.transitionUploadStatus(assetId, 'VERIFYING', 'READY', {
      'metadata.verifiedAt': new Date(),
    });
  } catch (error) {
    await repository.transitionUploadStatus(assetId, 'VERIFYING', 'FAILED', {
      'metadata.failureCode': error.code || 'MEDIA_UPLOAD_VERIFY_FAILED',
    });
    throw error;
  }
}

async function abortUpload(assetId, auth) {
  const asset = await repository.findById(assetId);
  assertOwned(asset, auth);
  if (asset.uploadStatus === 'ABORTED') return asset;
  if (asset.uploadStatus === 'READY') fail('Ready asset cannot be aborted', httpStatus.CONFLICT, 'MEDIA_UPLOAD_INCOMPLETE');
  await wasabi.abortMultipartUpload({
    key: asset.providerAssetId,
    uploadId: asset.metadata.multipartUploadId,
  });
  return repository.transitionUploadStatus(assetId, asset.uploadStatus, 'ABORTED');
}

module.exports = { abortUpload, completeUpload, initiateUpload, presignParts };
