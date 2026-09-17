const { createHash } = require('crypto');
const { Readable } = require('stream');
const cloudinary = require('cloudinary').v2;
const { pipeline } = require('stream/promises');
const repository = require('../repositories/mediaAsset.repository');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');

function validateListingImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 10 * 1024 * 1024) {
    throw new AppError('Image must be between 1 byte and 10 MiB', 400, true, errorCodes.VALIDATION_ERROR);
  }
  let mimeType;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) mimeType = 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mimeType = 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') mimeType = 'image/webp';
  if (!mimeType) throw new AppError('Only JPEG, PNG and WebP image bytes are accepted', 400, true, errorCodes.VALIDATION_ERROR);
  return { mimeType, hash: createHash('sha256').update(buffer).digest('hex') };
}
async function storeListingImage({ buffer, shopId, listingId, sourceUrl }) {
  const { mimeType, hash } = validateListingImageBuffer(buffer);
  const identity = { shopId, ownerType: 'CATALOG_LISTING', ownerId: listingId, sha256: hash, provider: 'cloudinary', discardedAt: null, uploadStatus: 'READY', assetPurpose: 'PREVIEW' };
  const existing = await repository.findListingImage(identity);
  if (existing) return existing;
  const { CLOUDINARY_CLOUD_NAME: cloud_name, CLOUDINARY_API_KEY: api_key, CLOUDINARY_API_SECRET: api_secret } = process.env;
  if (!cloud_name || !api_key || !api_secret) throw new AppError('Cloudinary configuration is incomplete', 503, true, 'MEDIA_CLOUDINARY_CONFIG_MISSING');
  cloudinary.config({ cloud_name, api_key, api_secret });
  // Content-derived identity also recovers an upload whose database write failed.
  const publicId = `listing-images/${shopId}/${listingId}/${hash}`;
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ resource_type: 'image', public_id: publicId, overwrite: false, unique_filename: false, timeout: 60000 }, (error, value) => error ? reject(error) : resolve(value));
    pipeline(Readable.from(buffer), stream).catch(reject);
  }).catch(() => { throw new AppError('Cloudinary upload failed; retry this item after resolving the provider error', 502, true, 'MEDIA_CLOUDINARY_UPLOAD_FAILED'); });
  if (!result?.secure_url) throw new AppError('Cloudinary did not return a delivery URL', 502, true, 'MEDIA_UPLOAD_FAILED');
  return repository.upsertListingImage(identity, {
    ...identity, originalFilename: `${hash}.${mimeType.split('/')[1]}`, storageFilename: publicId,
    relativeStoragePath: result.secure_url, providerAssetId: result.public_id, secureUrl: result.secure_url,
    mimeType, size: buffer.length, resourceType: 'image', assetPurpose: 'PREVIEW', uploadStatus: 'READY',
    metadata: { purpose: 'LISTING_IMAGE_SYNC', sourceUrl },
  });
}
module.exports = { validateListingImageBuffer, storeListingImage };
