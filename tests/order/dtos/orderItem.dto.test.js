const { toOrderItemDto } = require('../../../src/modules/order/dtos/orderItem.dto');

describe('orderItem.dto', () => {
  test('same-source reimport preserves saved image even without another queue job', () => {
    const { buildItemUpdatePayload } = require('../../../src/modules/order/services/orderImport.payloads');
    const { toMarketplaceItemFields } = require('../../../src/modules/order/dtos/orderItem.dto');
    const url = 'https://i.etsystatic.com/image.jpg';
    const prior = { salesChannelCode: 'ETSY', listingImage: { sourceUrl: url, mediaAssetId: 'asset' } };
    const incoming = { externalData: { etsy: { listingImageUrl: url } } };
    const patch = buildItemUpdatePayload(incoming, {}, new Date(), []);
    expect(toMarketplaceItemFields({ ...prior, ...patch.set }).listingImageAssetId).toBe('asset');
    expect(toMarketplaceItemFields({ ...prior, externalData: { etsy: { listingImageUrl: 'https://i.etsystatic.com/new.jpg' } } }).listingImageAssetId).toBeNull();
  });
  test('marketplace display rejects non-Etsy image hosts and raw variant objects', () => {
    const { toMarketplaceItemFields } = require('../../../src/modules/order/dtos/orderItem.dto');
    expect(toMarketplaceItemFields({ salesChannelCode: 'ETSY', variantRaw: { secret: 'hidden' }, externalData: { etsy: { listingImageUrl: 'https://evil.example/image.jpg' } } })).toMatchObject({ variations: null, listingImageUrl: null });
    expect(toMarketplaceItemFields({ salesChannelCode: 'ETSY', listingImageUrl: 'https://user:pass@i.etsystatic.com/image.jpg' }).listingImageUrl).toBeNull();
  });
  test('standard item DTO excludes raw variant, customization, and external snapshots', () => {
    const dto = toOrderItemDto({
      _id: '660000000000000000000401',
      orderId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      variantRaw: { Color: 'Sand' },
      customizationRawSummary: {
        customizationUrl: 'https://secret.example.test/customization',
      },
      externalData: {
        amazon: { token: 'secret-token' },
      },
    });

    expect(dto).not.toHaveProperty('variantRaw');
    expect(dto).not.toHaveProperty('customizationRawSummary');
    expect(dto).not.toHaveProperty('externalData');
    expect(JSON.stringify(dto)).not.toContain('secret');
  });
});
