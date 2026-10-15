const crypto = require('crypto');
const path = require('path');
const { Readable } = require('stream');
const AppError = require('../../../shared/errors/appError');
const repository = require('../repositories/mediaAsset.repository');
const storage = require('./mediaAsset.service');

function invalid(message) { return new AppError(message, 400, true, 'VALIDATION_ERROR'); }

function assertImage(file) {
  const bytes = file?.buffer;
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 10 * 1024 * 1024) throw invalid('Invalid image size');
  const ext = path.extname(file.originalname || '').toLowerCase();
  const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!(png && ext === '.png' && file.mimetype === 'image/png')
    && !(jpeg && ['.jpg', '.jpeg'].includes(ext) && file.mimetype === 'image/jpeg')
    && !(webp && ext === '.webp' && file.mimetype === 'image/webp')) throw invalid('Unsupported image bytes or type');
}

function toDto(asset, reused) {
  return { mediaAssetId: String(asset._id), filename: asset.originalFilename, contentType: asset.mimeType, sha256: asset.sha256, reused };
}

async function storeImportAsset({ file, sha256, shopId, jobId }) {
  assertImage(file);
  const digest = crypto.createHash('sha256').update(file.buffer).digest('hex');
  if (digest !== sha256) throw invalid('File hash mismatch');
  const identity = { shopId, jobId, sha256: digest };
  const existing = await repository.findImportAsset(identity);
  if (existing) return toDto(existing, true);
  try {
    const asset = await storage.storeAsset({ stream: Readable.from(file.buffer), filename: path.basename(file.originalname), mimeType: file.mimetype, maxBytes: 10 * 1024 * 1024, shopId, ownerType: 'ETSY_IMPORT', ownerId: jobId });
    return toDto(asset, false);
  } catch (error) {
    if (error.code === 11000) {
      const raced = await repository.findImportAsset(identity);
      if (raced) return toDto(raced, true);
    }
    throw error;
  }
}

module.exports = { storeImportAsset, assertImage };
