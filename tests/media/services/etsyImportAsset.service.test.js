jest.mock('../../../src/modules/media/repositories/mediaAsset.repository', () => ({ findImportAsset: jest.fn() }));
jest.mock('../../../src/modules/media/services/mediaAsset.service', () => ({ storeAsset: jest.fn() }));
const crypto = require('crypto');
const repository = require('../../../src/modules/media/repositories/mediaAsset.repository');
const storage = require('../../../src/modules/media/services/mediaAsset.service');
const service = require('../../../src/modules/media/services/etsyImportAsset.service');
const buffer = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
const file = { buffer, originalname: 'photo.png', mimetype: 'image/png' };
beforeEach(() => jest.resetAllMocks());
test('rejects forged content hashes before storing', async () => {
  await expect(service.storeImportAsset({ file, sha256: '0'.repeat(64), shopId: 'shop', jobId: 'job' })).rejects.toThrow('hash');
  expect(storage.storeAsset).not.toHaveBeenCalled();
});
test('rejects HTML disguised as an image', async () => {
  const html = Buffer.from('<html>login</html>');
  await expect(service.storeImportAsset({ file: { ...file, buffer: html }, sha256: crypto.createHash('sha256').update(html).digest('hex'), shopId: 'shop', jobId: 'job' })).rejects.toThrow('image');
});
test('reuses an existing ready asset only from this shop and job', async () => {
  repository.findImportAsset.mockResolvedValue({ _id: 'asset', uploadStatus: 'READY', sha256 });
  const result = await service.storeImportAsset({ file, sha256, shopId: 'shop', jobId: 'job' });
  expect(result.mediaAssetId).toBe('asset');
  expect(result.reused).toBe(true);
  expect(repository.findImportAsset).toHaveBeenCalledWith({ shopId: 'shop', jobId: 'job', sha256 });
  expect(storage.storeAsset).not.toHaveBeenCalled();
});
