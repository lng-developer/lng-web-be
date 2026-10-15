const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const cloudinary = require('cloudinary').v2;
const config = require('../../../config');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { normalizeSearchTerm } = require('../../../shared/utils/search');
const authPublic = require('../../auth/public');
const repository = require('../repositories/mediaAsset.repository');
const wasabi = require('./wasabiStorage.service');

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function serviceError(message, code) {
  return Object.assign(new Error(message), { code });
}

const ownerReadPermissions = {
  CATALOG: ['CATALOG:READ'],
  CATALOG_LISTING: ['CATALOG:READ'],
  CATALOG_LISTING_VARIANT: ['CATALOG:READ'],
  CUSTOMIZATION: ['ORDERS:READ'],
  CUSTOMIZATION_PAYLOAD: ['ORDERS:READ'],
  DESIGN: ['DESIGN:READ', 'DESIGN:WORK', 'DESIGN:REVIEW'],
  DESIGN_TASK: ['DESIGN:READ', 'DESIGN:WORK', 'DESIGN:REVIEW'],
  ORDER: ['ORDERS:READ'],
  ORDER_ITEM: ['ORDERS:READ'],
  PRODUCTION: ['PRODUCTION:READ', 'PRODUCTION:WRITE', 'PRODUCTION:REVIEW'],
  PRODUCTION_TASK: ['PRODUCTION:READ', 'PRODUCTION:WRITE', 'PRODUCTION:REVIEW'],
  WORK_SCORE: ['WORK_SCORES:READ', 'WORK_SCORES:ADJUST'],
};

function getStorageRoot() {
  return path.resolve(process.env.MEDIA_STORAGE_ROOT || path.resolve(process.cwd(), 'storage', 'media'));
}

function getStorageProvider() {
  return String(process.env.MEDIA_STORAGE_PROVIDER || 'local').trim().toLowerCase();
}

function ensureInsideRoot(root, target) {
  const relative = path.relative(root, target);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw serviceError('Storage path escapes MEDIA_STORAGE_ROOT', 'MEDIA_STORAGE_PATH_INVALID');
  }
}

function sanitizeFilename(filename) {
  const basename = path.basename(String(filename || 'asset.bin')).trim();
  const sanitized = basename
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180);

  return sanitized || 'asset.bin';
}

function getSafeExtension(filename) {
  const extension = path.extname(filename).toLowerCase();

  if (!extension || extension.length > 16 || !/^\.[a-z0-9]+$/.test(extension)) {
    return '.bin';
  }

  return extension;
}

function createHashAndLimitTransform(maxBytes = DEFAULT_MAX_BYTES) {
  const hash = crypto.createHash('sha256');
  let size = 0;

  const transform = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;

      if (size > maxBytes) {
        callback(serviceError('Media asset exceeded maxBytes', 'MEDIA_ASSET_TOO_LARGE'));
        return;
      }

      hash.update(chunk);
      callback(null, chunk);
    },
  });

  transform.getResult = () => ({
    size,
    sha256: hash.digest('hex'),
  });

  return transform;
}

function cloudinaryResourceType(mimeType) {
  if (String(mimeType || '').startsWith('image/')) return 'image';
  if (String(mimeType || '').startsWith('video/')) return 'video';
  return 'raw';
}

function assertCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw serviceError('Cloudinary configuration is incomplete', 'MEDIA_CLOUDINARY_CONFIG_MISSING');
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
}

function uploadToCloudinary({ stream, originalFilename, mimeType, maxBytes }) {
  assertCloudinaryConfig();
  const hashAndLimit = createHashAndLimitTransform(maxBytes);
  const extension = getSafeExtension(originalFilename);
  const publicId = `${path.basename(originalFilename, extension)}-${crypto.randomUUID()}`;
  const resourceType = cloudinaryResourceType(mimeType);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream({
      resource_type: resourceType,
      folder: process.env.CLOUDINARY_FOLDER || 'lng-system/media',
      public_id: publicId,
      use_filename: false,
      unique_filename: false,
    }, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      const { size, sha256 } = hashAndLimit.getResult();
      resolve({
        uploadResult: result,
        resourceType,
        size,
        sha256,
      });
    });

    pipeline(stream, hashAndLimit, uploadStream).catch(reject);
  });
}

function downloadHttpsToFile(url, filePath, maxBytes = DEFAULT_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    if (parsed.protocol !== 'https:') {
      reject(serviceError('Cloudinary asset URL must be https', 'MEDIA_CLOUDINARY_URL_INVALID'));
      return;
    }

    const request = https.get(url, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(serviceError(`Cloudinary asset download failed with HTTP ${response.statusCode}`, 'MEDIA_CLOUDINARY_DOWNLOAD_FAILED'));
        response.resume();
        return;
      }

      pipeline(
        response,
        createHashAndLimitTransform(maxBytes),
        fs.createWriteStream(filePath, { flags: 'wx' }),
      ).then(resolve).catch(reject);
    });

    request.on('error', reject);
  });
}

async function removeIfExists(filePath) {
  await fs.promises.rm(filePath, { force: true });
}

async function storeAsset({
  stream,
  filename,
  mimeType = null,
  sourceUrlRedacted = null,
  sourceUrlHash = null,
  metadata = {},
  shopId = null,
  ownerType = null,
  ownerId = null,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!stream || typeof stream.pipe !== 'function') {
    throw serviceError('stream is required', 'MEDIA_ASSET_STREAM_REQUIRED');
  }

  const originalFilename = sanitizeFilename(filename);

  if (getStorageProvider() === 'cloudinary') {
    const { uploadResult, resourceType, size, sha256 } = await uploadToCloudinary({
      stream,
      originalFilename,
      mimeType,
      maxBytes,
    });

    return repository.create({
      originalFilename,
      storageFilename: uploadResult.public_id,
      mimeType,
      size,
      sha256,
      relativeStoragePath: uploadResult.secure_url || uploadResult.url || uploadResult.public_id,
      provider: 'cloudinary',
      providerAssetId: uploadResult.public_id,
      resourceType: uploadResult.resource_type || resourceType,
      secureUrl: uploadResult.secure_url || null,
      sourceUrlRedacted,
      sourceUrlHash,
      metadata,
      shopId,
      ownerType,
      ownerId,
    });
  }

  const root = getStorageRoot();
  const tmpDir = path.join(root, 'tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const tempFilename = `${crypto.randomUUID()}.part`;
  const tempPath = path.join(tmpDir, tempFilename);
  ensureInsideRoot(root, tempPath);

  const hashAndLimit = createHashAndLimitTransform(maxBytes);
  let finalPath = null;

  try {
    await pipeline(
      stream,
      hashAndLimit,
      fs.createWriteStream(tempPath, { flags: 'wx' }),
    );

    const { size, sha256 } = hashAndLimit.getResult();
    const storageFilename = `${sha256}-${crypto.randomUUID()}${getSafeExtension(originalFilename)}`;
    finalPath = path.join(root, storageFilename);
    ensureInsideRoot(root, finalPath);
    await fs.promises.rename(tempPath, finalPath);

    try {
      return await repository.create({
        originalFilename,
        storageFilename,
        mimeType,
        size,
        sha256,
        relativeStoragePath: storageFilename,
        provider: 'local',
        providerAssetId: null,
        resourceType: null,
        secureUrl: null,
        sourceUrlRedacted,
        sourceUrlHash,
        metadata,
        shopId,
        ownerType,
        ownerId,
      });
    } catch (error) {
      await removeIfExists(finalPath);
      throw error;
    }
  } catch (error) {
    await removeIfExists(tempPath);
    throw error;
  }
}

async function discardUnattachedAsset(assetId, expectedMetadata, reason) {
  const asset = await repository.markDiscardedIfMetadataMatches(assetId, expectedMetadata, reason);
  if (!asset) {
    throw serviceError('Media asset does not match the unattached upload', 'MEDIA_ASSET_DISCARD_NOT_ALLOWED');
  }

  if (asset.provider === 'cloudinary') {
    assertCloudinaryConfig();
    await cloudinary.uploader.destroy(asset.providerAssetId, {
      resource_type: asset.resourceType || 'raw',
    });
    return asset;
  }

  const root = getStorageRoot();
  const filePath = path.resolve(root, asset.relativeStoragePath || '');
  ensureInsideRoot(root, filePath);
  await removeIfExists(filePath);
  return asset;
}

async function buildLocalReadAccess(assetId, existingAsset = null) {
  const mediaAsset = existingAsset || await repository.findById(assetId);

  if (!mediaAsset) {
    throw new AppError('Media asset not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const root = getStorageRoot();

  async function materializeRemoteReadAccess() {
    const tmpDir = path.join(root, 'tmp');
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const localPath = path.join(tmpDir, `${crypto.randomUUID()}.read`);
    ensureInsideRoot(root, localPath);
    await downloadHttpsToFile(mediaAsset.secureUrl || mediaAsset.relativeStoragePath, localPath, mediaAsset.size || DEFAULT_MAX_BYTES);

    return {
      mediaAsset,
      localPath,
      cleanup: async () => removeIfExists(localPath),
    };
  }

  if (mediaAsset.provider === 'cloudinary') {
    return materializeRemoteReadAccess();
  }

  const localPath = path.resolve(root, mediaAsset.relativeStoragePath || '');
  ensureInsideRoot(root, localPath);

  let stat;
  try {
    stat = await fs.promises.stat(localPath);
  } catch (error) {
    if (mediaAsset.secureUrl) return materializeRemoteReadAccess();
    throw new AppError('Media asset not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (!stat.isFile()) {
    throw new AppError('Media asset not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  if (Number.isInteger(mediaAsset.size) && stat.size !== mediaAsset.size) {
    throw serviceError('Media asset file size mismatch', 'MEDIA_ASSET_SIZE_MISMATCH');
  }

  return {
    mediaAsset,
    localPath,
  };
}

async function withReadAccess(readAccess, callback) {
  try {
    return await callback({
      mediaAsset: readAccess.mediaAsset,
      localPath: readAccess.localPath,
    });
  } finally {
    if (typeof readAccess.cleanup === 'function') {
      await readAccess.cleanup();
    }
  }
}

async function withAssetLocalReadFile(assetId, callback) {
  if (typeof callback !== 'function') {
    throw serviceError('callback is required', 'MEDIA_ASSET_READ_CALLBACK_REQUIRED');
  }

  return withReadAccess(await buildLocalReadAccess(assetId), callback);
}

function toId(value) {
  if (!value) return null;
  if (value._id) return String(value._id);
  return String(value);
}

async function canReadProductionTaskAsset(asset, authContext = {}) {
  if (String(asset.ownerType || '').toUpperCase() !== 'PRODUCTION_TASK') return false;
  const taskId = toId(asset.ownerId);
  if (!taskId) return false;
  const productionPublic = require('../../production/public');
  return typeof productionPublic.canReadTaskById === 'function'
    && productionPublic.canReadTaskById(taskId, authContext);
}

async function assertAssetReadAccess(asset, authContext = {}) {
  const ownerType = String(asset.ownerType || '').toUpperCase();
  if (ownerType === 'CHAT' && asset.ownerId) {
    const chatPublic = require('../../chat/public');
    if (await chatPublic.canReadConversation(String(asset.ownerId), authContext)) return;
  }

  const isCustomization =
    ownerType === 'CUSTOMIZATION'
    || ownerType === 'CUSTOMIZATION_PAYLOAD'
    || asset.metadata?.source === 'CUSTOMIZATION_ZIP_ENTRY'
    || Boolean(asset.metadata?.sourceZipAssetId)
    || Boolean(asset.metadata?.sourceZipUrlRedacted);

  if (isCustomization) {
    if (asset.shopId) {
      if (authPublic.canAccessScope(authContext, 'ORDERS:READ', { scopeType: 'SHOP', scopeId: asset.shopId })) {
        return;
      }
    } else {
      const hasOrderRead = (authContext.permissions || []).includes('ORDERS:READ')
        || (authContext.scopes || []).some((scope) => (
          (scope.permissions || []).includes('ORDERS:READ')
        ));
      if (hasOrderRead) {
        return;
      }
    }
  }

  const permissions = ['MEDIA:READ', ...(ownerReadPermissions[ownerType] || [])];
  const scope = asset.shopId ? { scopeType: 'SHOP', scopeId: asset.shopId } : { scopeType: null, scopeId: null };

  const allowed = permissions.some((permission) => (
    authPublic.canAccessScope(authContext, permission, scope)
  ));
  if (allowed) return;
  if (await canReadProductionTaskAsset(asset, authContext)) return;

  throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

async function getAsset(assetId) {
  const mediaAsset = await repository.findById(assetId);
  if (!mediaAsset) {
    throw new AppError('Media asset not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return mediaAsset;
}

async function getAuthorizedAsset(assetId, authContext) {
  const asset = await getAsset(assetId);
  await assertAssetReadAccess(asset, authContext);
  return asset;
}

async function getAuthorizedDownloadUrl(assetId, authContext, options = {}) {
  const asset = await getAuthorizedAsset(assetId, authContext);
  if (asset.provider !== 'wasabi') return null;
  if (asset.uploadStatus !== 'READY') {
    throw new AppError('Media asset is not ready', httpStatus.CONFLICT, true, 'MEDIA_ASSET_NOT_READY');
  }
  return wasabi.presignDownload({
    key: asset.providerAssetId,
    filename: asset.originalFilename || 'asset.bin',
    expiresIn: config.media.wasabi.downloadUrlTtlSeconds,
    disposition: options.disposition,
  });
}

async function getPublicAssetUrl(assetId) {
  const asset = await getAsset(assetId);
  if (asset.uploadStatus && asset.uploadStatus !== 'READY') return null;
  if (asset.provider === 'cloudinary') return asset.secureUrl || null;
  if (asset.provider === 'wasabi') {
    return wasabi.presignDownload({
      key: asset.providerAssetId,
      filename: asset.originalFilename || 'asset.bin',
      expiresIn: config.media.wasabi.downloadUrlTtlSeconds,
    });
  }
  return null;
}

async function withAuthorizedAssetLocalReadFile(assetId, authContext, callback) {
  if (typeof callback !== 'function') {
    throw serviceError('callback is required', 'MEDIA_ASSET_READ_CALLBACK_REQUIRED');
  }
  const asset = await getAuthorizedAsset(assetId, authContext);
  return withReadAccess(await buildLocalReadAccess(assetId, asset), callback);
}

async function getAssetsByIds(assetIds = []) {
  const ids = [...new Set((assetIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  return repository.findByIds(ids);
}

async function findAssetsByProviderAssetIds(provider, providerAssetIds = []) {
  const ids = [...new Set((providerAssetIds || []).filter(Boolean).map(String))];
  return ids.length ? repository.findByProviderAssetIds(provider, ids) : [];
}

async function registerExternalAsset(input = {}) {
  if (!input.provider || !input.providerAssetId || !input.originalFilename || !input.storageFilename) {
    throw serviceError('external asset fields are required', 'MEDIA_EXTERNAL_ASSET_INVALID');
  }
  return repository.create({
    originalFilename: sanitizeFilename(input.originalFilename),
    storageFilename: String(input.storageFilename),
    mimeType: input.mimeType || null,
    size: Number.isInteger(input.size) && input.size >= 0 ? input.size : 0,
    sha256: null,
    relativeStoragePath: String(input.relativeStoragePath || input.providerAssetId),
    provider: String(input.provider),
    assetPurpose: input.assetPurpose || null,
    uploadStatus: 'READY',
    providerAssetId: String(input.providerAssetId),
    resourceType: input.resourceType || null,
    secureUrl: input.secureUrl || null,
    metadata: input.metadata || {},
    shopId: input.shopId || null,
    ownerType: input.ownerType || null,
    ownerId: input.ownerId || null,
  });
}

async function attachAssetsToChat(assetIds = [], conversationId) {
  const ids = [...new Set((assetIds || []).filter(Boolean).map(String))];
  await Promise.all(ids.map((assetId) => repository.updateById(assetId, {
    ownerType: 'CHAT',
    ownerId: conversationId,
  })));
}

async function findAssetIdsByOriginalFilename(search) {
  return repository.findIdsByOriginalFilename(normalizeSearchTerm(search));
}

async function listAssets(query) {
  return repository.list(query);
}

async function readAssetBuffer(assetId) {
  try {
    return await withAssetLocalReadFile(assetId, async ({ mediaAsset, localPath }) => ({
      asset: mediaAsset,
      buffer: await fs.promises.readFile(localPath),
    }));
  } catch (error) {
    if (['MEDIA_ASSET_NOT_FOUND', 'MEDIA_ASSET_FILE_NOT_FOUND'].includes(error.code)) {
      throw new AppError('Media asset not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    throw error;
  }
}

async function assertMediaAssetExists(assetId) {
  const mediaAsset = await repository.findById(assetId);
  if (!mediaAsset) {
    throw new AppError('Media asset not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return mediaAsset;
}

async function assertMediaAssetReady(assetId) {
  const mediaAsset = await assertMediaAssetExists(assetId);
  if ((mediaAsset.uploadStatus || 'READY') !== 'READY') {
    throw new AppError('Media asset is not ready', httpStatus.CONFLICT, true, 'MEDIA_ASSET_NOT_READY');
  }
  return mediaAsset;
}

module.exports = {
  discardUnattachedAsset,
  findAssetIdsByOriginalFilename,
  listAssets,
  getAsset,
  getAuthorizedAsset,
  getAuthorizedDownloadUrl,
  getPublicAssetUrl,
  attachAssetsToChat,
  getAssetsByIds,
  findAssetsByProviderAssetIds,
  registerExternalAsset,
  getStorageProvider,
  readAssetBuffer,
  storeAsset,
  withAssetLocalReadFile,
  withAuthorizedAssetLocalReadFile,
  assertMediaAssetExists,
  assertMediaAssetReady,
  withReadAccess,
  sanitizeFilename,
  createHashAndLimitTransform,
};
