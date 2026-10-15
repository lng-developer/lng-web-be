const { Readable } = require('stream');
jest.mock('../../../src/modules/media/repositories/mediaAsset.repository', () => ({ findEtsyListingImage: jest.fn() }));
jest.mock('../../../src/modules/media/services/mediaAsset.service', () => ({ storeAsset: jest.fn() }));
jest.mock('../../../src/shared/network/safeRemoteFetchStream', () => ({ safeRemoteFetchStream: jest.fn(), redactUrl: () => 'https://i.etsystatic.com/[REDACTED_PATH]' }));
const repository = require('../../../src/modules/media/repositories/mediaAsset.repository');
const storage = require('../../../src/modules/media/services/mediaAsset.service');
const remote = require('../../../src/shared/network/safeRemoteFetchStream');
const service = require('../../../src/modules/media/services/etsyListingImage.service');
const sourceUrl = 'https://i.etsystatic.com/123/il_680x540.123_x.jpg';
beforeEach(() => jest.resetAllMocks());

test.each(['http://i.etsystatic.com/x.jpg', 'https://evil.test/x.jpg', 'https://i.etsystatic.com:444/x.jpg', 'https://user:pass@i.etsystatic.com/x.jpg'])('rejects untrusted source %s', async (url) => {
  await expect(service.storeEtsyListingImage({ sourceUrl: url, shopId: 'shop' })).rejects.toThrow();
  expect(remote.safeRemoteFetchStream).not.toHaveBeenCalled();
});
test('reuses same source within shop without downloading again', async () => {
  repository.findEtsyListingImage.mockResolvedValue({ _id: 'asset' });
  expect(await service.storeEtsyListingImage({ sourceUrl, shopId: 'shop' })).toEqual({ mediaAssetId: 'asset' });
  expect(remote.safeRemoteFetchStream).not.toHaveBeenCalled();
  expect(repository.findEtsyListingImage).toHaveBeenCalledWith(expect.objectContaining({ shopId: 'shop' }));
});
test('stores verified image bytes and applies URL policy to redirects', async () => {
  remote.safeRemoteFetchStream.mockResolvedValue({ stream: Readable.from(Buffer.from('ffd8ff00', 'hex')), metadata: { contentType: 'image/jpeg' } });
  storage.storeAsset.mockResolvedValue({ _id: 'asset' });
  expect(await service.storeEtsyListingImage({ sourceUrl, shopId: 'shop' })).toEqual({ mediaAssetId: 'asset' });
  const options = remote.safeRemoteFetchStream.mock.calls[0][1];
  expect(() => options.validateUrl('http://127.0.0.1/test')).toThrow();
  expect(storage.storeAsset).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'ETSY_LISTING_IMAGE', shopId: 'shop', mimeType: 'image/jpeg' }));
});
test('rejects HTML masquerading as an image', async () => {
  remote.safeRemoteFetchStream.mockResolvedValue({ stream: Readable.from(Buffer.from('<html>login</html>')), metadata: { contentType: 'image/jpeg' } });
  await expect(service.storeEtsyListingImage({ sourceUrl, shopId: 'shop' })).rejects.toThrow();
  expect(storage.storeAsset).not.toHaveBeenCalled();
});
