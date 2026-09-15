const sharp = require('sharp');
const { normalizeMockup } = require('../../../src/modules/listingLaunch/services/mockupImage');
const file = (buffer, mimetype = 'image/png', originalname = 'mockup.png') => ({ buffer, mimetype, originalname });
test('normalizes real pixels, strips metadata and limits dimensions without enlargement', async () => {
  const buffer = await sharp({ create: { width: 3000, height: 10, channels: 4, background: '#00000000' } }).png().toBuffer();
  const result = await normalizeMockup(file(buffer));
  expect(result).toMatchObject({ mimeType: 'image/jpeg', width: 2048 });
  const metadata = await sharp(result.buffer).metadata();
  expect(metadata.exif).toBeUndefined();
  expect(metadata.hasAlpha).toBe(false);
});
test('rejects corrupt bytes, MIME spoofing, multiple frames and excessive byte count', async () => {
  await expect(normalizeMockup(file(Buffer.from('broken')))).rejects.toMatchObject({ code: 'MOCKUP_IMAGE_INVALID' });
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await expect(normalizeMockup(file(png, 'image/jpeg', 'x.jpg'))).rejects.toMatchObject({ code: 'MOCKUP_IMAGE_INVALID' });
  await expect(normalizeMockup(file(Buffer.alloc(10 * 1024 * 1024 + 1)))).rejects.toMatchObject({ statusCode: 413 });
  const animated = await sharp(Buffer.concat([Buffer.alloc(12), Buffer.alloc(12, 255)]), { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(animated).metadata()).pages).toBe(2);
  await expect(normalizeMockup(file(animated, 'image/webp', 'x.webp'))).rejects.toMatchObject({ code: 'MOCKUP_IMAGE_INVALID' });
});
