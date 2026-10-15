jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({ findById: jest.fn(), attachListingImage: jest.fn() }));
jest.mock('../../../src/modules/media/public', () => ({ storeEtsyListingImage: jest.fn() }));
jest.mock('../../../src/modules/catalog/public', () => ({ fillEtsyListingImage: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderWorkbenchProjection.service', () => ({ updateOrderWorkbenchItem: jest.fn() }));
const repo = require('../../../src/modules/order/repositories/orderItem.repository');
const media = require('../../../src/modules/media/public');
const projection = require('../../../src/modules/order/services/orderWorkbenchProjection.service');
const service = require('../../../src/modules/order/services/etsyListingImage.service');
const sourceUrl = 'https://i.etsystatic.com/123/a.jpg';
beforeEach(() => jest.resetAllMocks());
test('stale or wrong-shop jobs never download or attach', async () => {
  repo.findById.mockResolvedValue({ shopId: 'other', salesChannelCode: 'ETSY', externalData: { etsy: { listingImageUrl: sourceUrl } } });
  await service.processListingImage({ orderItemId: 'item', shopId: 'shop', sourceUrl });
  expect(media.storeEtsyListingImage).not.toHaveBeenCalled();
});
test('attaches saved Media and forwards the exact Etsy identity to fill a missing Catalog image', async () => {
  repo.findById.mockResolvedValue({ shopId: 'shop', salesChannelCode: 'ETSY', externalData: { etsy: { listingImageUrl: sourceUrl } } });
  media.storeEtsyListingImage.mockResolvedValue({ mediaAssetId: 'asset' });
  repo.attachListingImage.mockResolvedValue({ orderId: 'order', shopId: 'shop', marketplaceCode: 'ETSY_US', externalListingId: '123' });
  await service.processListingImage({ orderItemId: 'item', shopId: 'shop', sourceUrl });
  expect(repo.attachListingImage).toHaveBeenCalledWith({ orderItemId: 'item', shopId: 'shop', sourceUrl, mediaAssetId: 'asset' });
  expect(projection.updateOrderWorkbenchItem).toHaveBeenCalledWith('order', 'item', { 'item.listingImageAssetId': 'asset' }, { expectedListingImageUrl: sourceUrl });
  expect(require('../../../src/modules/catalog/public').fillEtsyListingImage).toHaveBeenCalledWith({ shopId: 'shop', marketplaceCode: 'ETSY_US', etsyListingId: '123', productImageUrl: sourceUrl });
});
test('failure propagates for queue retry without changing order state', async () => {
  repo.findById.mockResolvedValue({ shopId: 'shop', salesChannelCode: 'ETSY', externalData: { etsy: { listingImageUrl: sourceUrl } } });
  media.storeEtsyListingImage.mockRejectedValue(new Error('timeout'));
  await expect(service.processListingImage({ orderItemId: 'item', shopId: 'shop', sourceUrl })).rejects.toThrow('timeout');
  expect(repo.attachListingImage).not.toHaveBeenCalled();
});
