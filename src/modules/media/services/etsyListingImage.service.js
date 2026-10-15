const crypto = require('crypto');
const path = require('path');
const { Readable } = require('stream');
const { safeRemoteFetchStream, redactUrl } = require('../../../shared/network/safeRemoteFetchStream');
const repository = require('../repositories/mediaAsset.repository');
const storage = require('./mediaAsset.service');
const { assertImage } = require('./etsyImportAsset.service');

const MAX_BYTES = 2 * 1024 * 1024;

function validateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'i.etsystatic.com' || url.port || url.username || url.password) {
    throw new Error('Untrusted Etsy image URL');
  }
  return url;
}

async function storeEtsyListingImage({ sourceUrl, shopId }) {
  if (!shopId) throw new Error('Shop is required for listing image');
  const url = validateUrl(sourceUrl);
  const sourceUrlHash = crypto.createHash('sha256').update(url.href).digest('hex');
  const identity = { shopId, sourceUrlHash };
  const existing = await repository.findEtsyListingImage(identity);
  if (existing) return { mediaAssetId: String(existing._id) };
  const { stream, metadata } = await safeRemoteFetchStream(url.href, { maxBytes: MAX_BYTES, validateUrl });
  const timer = setTimeout(() => stream.destroy(new Error('Listing image download timed out')), 20000);
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error('Listing image too large');
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
  const buffer = Buffer.concat(chunks);
  const filename = path.basename(url.pathname);
  const mimeType = String(metadata.contentType || '').split(';')[0].trim().toLowerCase();
  assertImage({ buffer, originalname: filename, mimetype: mimeType });
  try {
    const asset = await storage.storeAsset({
      stream: Readable.from(buffer), filename, mimeType, shopId,
      ownerType: 'ETSY_LISTING_IMAGE', sourceUrlHash, sourceUrlRedacted: redactUrl(url.href), maxBytes: MAX_BYTES,
    });
    return { mediaAssetId: String(asset._id) };
  } catch (error) {
    if (error.code === 11000) {
      const winner = await repository.findEtsyListingImage(identity);
      if (winner) return { mediaAssetId: String(winner._id) };
    }
    throw error;
  }
}

module.exports = { storeEtsyListingImage };
