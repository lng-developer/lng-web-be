const path = require('node:path');
const sharp = require('sharp');
const AppError = require('../../../shared/errors/appError');
const { maxBytes, maxPixels } = require('../constants/listingMockup.constants');

async function normalizeMockup(file) {
  if (!file?.buffer?.length) throw new AppError('An image is required', 400, true, 'MOCKUP_IMAGE_INVALID');
  if (file.buffer.length > maxBytes) throw new AppError('Image exceeds 10 MiB', 413, true, 'MOCKUP_IMAGE_TOO_LARGE');
  try {
    const image = sharp(file.buffer, { limitInputPixels: maxPixels, failOn: 'warning' });
    const metadata = await image.metadata();
    const formats = { png: ['image/png', '.png'], jpeg: ['image/jpeg', '.jpg', '.jpeg'], webp: ['image/webp', '.webp'] };
    const accepted = formats[metadata.format];
    if (!accepted || accepted[0] !== file.mimetype || !accepted.slice(1).includes(path.extname(file.originalname || '').toLowerCase())
      || (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) throw new Error('Invalid image');
    const { data, info } = await image.rotate().flatten({ background: '#ffffff' })
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    if (data.length > maxBytes) throw new AppError('Normalized image exceeds 10 MiB', 413, true, 'MOCKUP_IMAGE_TOO_LARGE');
    return { buffer: data, mimeType: 'image/jpeg', filename: 'mockup.jpg', width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Upload a valid, single-frame PNG, JPEG or WebP image', 400, true, 'MOCKUP_IMAGE_INVALID');
  }
}
module.exports = { normalizeMockup };
