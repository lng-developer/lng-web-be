const path = require('path');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const { hashString } = require('../../../shared/utils/crypto');
const { safeRemoteFetchStream, redactUrl } = require('../../../shared/network/safeRemoteFetchStream');
const authPublic = require('../../auth/public');
const mediaPublic = require('../../media/public');
const repository = require('../repositories/customizationPayload.repository');
const { customizationAssetTypes } = require('../constants/customizationAssetTypes');
const { customizationStatuses } = require('../constants/customizationStatuses');

const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_IDLE_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobalPermission(authContext, permission) {
  return Boolean(authContext && (authContext.permissions || []).includes(permission));
}

function assertCanAccessShop(shopId, permission, authContext) {
  if (!authContext || hasGlobalPermission(authContext, permission)) {
    return;
  }

  if (!authPublic.canAccessScope(authContext, permission, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

function normalizeBoolean(value) {
  return value === true || value === 'true';
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function extensionForMetadata(metadata = {}) {
  const contentType = String(metadata.contentType || '').toLowerCase();
  if (contentType.includes('zip')) return '.zip';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  if (contentType.includes('pdf')) return '.pdf';

  return {
    zip: '.zip',
    png: '.png',
    jpeg: '.jpg',
    pdf: '.pdf',
  }[metadata.classification] || '.bin';
}

function isZipResponse(metadata = {}) {
  return metadata.classification === 'zip'
    || String(metadata.contentType || '').toLowerCase().includes('zip');
}

function buildFilename(asset, metadata, index) {
  try {
    const parsed = new URL(asset.sourceUrl);
    const basename = path.basename(parsed.pathname || '');

    if (basename && path.extname(basename)) {
      return basename;
    }
  } catch (error) {
    // fall through to generated filename
  }

  return `customized-url-${index + 1}${extensionForMetadata(metadata)}`;
}

function shouldDownload(asset, retryFailed) {
  if (asset.type !== customizationAssetTypes.CUSTOMIZED_URL) return false;
  if (asset.status === customizationStatuses.DOWNLOADED) return false;
  if (asset.status === customizationStatuses.FAILED && !retryFailed) return false;
  return asset.status === customizationStatuses.PENDING
    || (asset.status === customizationStatuses.FAILED && retryFailed);
}

function skipped(asset, retryFailed) {
  return !shouldDownload(asset, retryFailed);
}

function buildFailedAsset(asset, error) {
  return {
    ...asset,
    status: customizationStatuses.FAILED,
    metadata: {
      ...(asset.metadata || {}),
      errorCode: error.code || 'ASSET_DOWNLOAD_FAILED',
      errorMessage: error.message,
      failedAt: new Date(),
    },
  };
}

function buildDownloadedAsset(asset, mediaAsset, responseMetadata) {
  return {
    ...asset,
    status: customizationStatuses.DOWNLOADED,
    assetId: mediaAsset ? mediaAsset._id || mediaAsset.id : null,
    metadata: {
      ...(asset.metadata || {}),
      ...(mediaAsset && { sha256: mediaAsset.sha256 }),
      ...(mediaAsset && { size: mediaAsset.size }),
      mimeType: (mediaAsset && mediaAsset.mimeType) || responseMetadata.contentType || null,
      classification: responseMetadata.classification,
      downloadedAt: new Date(),
    },
  };
}

async function loadPayload(orderItemId) {
  const payload = await repository.findByOrderItem(orderItemId);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  return payload;
}

async function persistAssets(payloadId, assets) {
  const payload = await repository.updateAssets(payloadId, assets);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  return payload;
}

async function downloadOneAsset(asset, index, options) {
  const { stream, metadata } = await safeRemoteFetchStream(asset.sourceUrl, {
    timeoutMs: options.timeoutMs,
    idleTimeoutMs: options.idleTimeoutMs,
    maxBytes: options.maxBytes,
    maxRedirects: options.maxRedirects,
  });
  if (isZipResponse(metadata)) {
    stream.resume();
    return buildDownloadedAsset(asset, null, metadata);
  }

  const sourceUrlRedacted = metadata.finalUrlRedacted || redactUrl(asset.sourceUrl);
  const mediaAsset = await mediaPublic.storeAsset({
    stream,
    filename: buildFilename(asset, metadata, index),
    mimeType: metadata.contentType,
    sourceUrlRedacted,
    sourceUrlHash: hashString(asset.sourceUrl),
    metadata: {
      classification: metadata.classification,
      redirects: metadata.redirects,
      originalSourceUrlRedacted: redactUrl(asset.sourceUrl),
    },
    maxBytes: options.maxBytes,
  });

  return buildDownloadedAsset(asset, mediaAsset, metadata);
}

async function downloadAssetsForOrderItem(orderItemId, options = {}, authContext) {
  const normalizedOptions = {
    retryFailed: normalizeBoolean(options.retryFailed),
    timeoutMs: normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    idleTimeoutMs: normalizePositiveInteger(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS),
    maxBytes: normalizePositiveInteger(options.maxBytes, DEFAULT_MAX_BYTES),
    maxRedirects: normalizePositiveInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS),
    concurrency: 1,
  };
  const payload = await loadPayload(orderItemId);
  assertCanAccessShop(payload.shopId, ORDER_WRITE_PERMISSION, authContext);

  let downloadedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let updatedPayload = payload;
  let assets = [...(payload.assets || [])];

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];

    if (skipped(asset, normalizedOptions.retryFailed)) {
      skippedCount += 1;
      continue;
    }

    try {
      assets[index] = await downloadOneAsset(asset, index, normalizedOptions);
      downloadedCount += 1;
    } catch (error) {
      assets[index] = buildFailedAsset(asset, error);
      failedCount += 1;
    }

    updatedPayload = await persistAssets(payload._id, assets);
    assets = [...(updatedPayload.assets || assets)];
  }

  return {
    payloadId: String(payload._id),
    downloadedCount,
    failedCount,
    skippedCount,
    assets,
    payload: updatedPayload,
  };
}

module.exports = {
  downloadAssetsForOrderItem,
};
