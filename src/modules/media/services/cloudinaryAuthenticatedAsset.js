const cloudinary = require('cloudinary').v2;
const AppError = require('../../../shared/errors/appError');

const unavailable = () => new AppError('Protected media storage is unavailable', 503, true, 'MOCKUP_STORAGE_UNAVAILABLE');
function assertAuthenticatedCloudinaryReady() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret || !/^[a-zA-Z0-9_-]+$/.test(cloud_name)) throw unavailable();
  return { cloud_name, api_key, api_secret };
}

async function readAuthenticatedCloudinaryAsset(asset, { maxBytes = 10 * 1024 * 1024, timeoutMs = 15000, signal } = {}) {
  const credentials = assertAuthenticatedCloudinaryReady();
  if (asset.provider !== 'cloudinary' || asset.deliveryType !== 'authenticated' || asset.uploadStatus !== 'READY' || asset.discardedAt) {
    throw new AppError('Media asset is not ready', 409, true, 'MEDIA_ASSET_NOT_READY');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 10 * 1024 * 1024
    || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw unavailable();
  if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maxBytes) {
    throw new AppError('Media asset exceeded byte limit', 413, true, 'MEDIA_ASSET_TOO_LARGE');
  }
  if (!asset.providerAssetId || asset.resourceType !== 'image' || asset.mimeType !== 'image/jpeg') throw unavailable();
  const url = cloudinary.url(asset.providerAssetId, { ...credentials, resource_type: 'image', type: 'authenticated', format: 'jpg', secure: true, sign_url: true });
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com' || !parsed.pathname.startsWith(`/${credentials.cloud_name}/`)) throw unavailable();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    if (!response.ok || !response.body) throw unavailable();
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new AppError('Media asset exceeded byte limit', 413, true, 'MEDIA_ASSET_TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    if (size !== asset.size) throw new AppError('Media asset size changed', 409, true, 'MEDIA_ASSET_SIZE_MISMATCH');
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

async function destroyAuthenticatedCloudinaryAsset(asset) {
  const credentials = assertAuthenticatedCloudinaryReady();
  try {
    return await cloudinary.uploader.destroy(asset.providerAssetId, { ...credentials, resource_type: asset.resourceType || 'image', type: 'authenticated' });
  } catch { throw unavailable(); }
}

module.exports = { assertAuthenticatedCloudinaryReady, readAuthenticatedCloudinaryAsset, destroyAuthenticatedCloudinaryAsset };
