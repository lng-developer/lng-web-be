const ListingLaunch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');

test('draft schema has bounded fields, Amazon-only states and shop indexes', () => {
  const draft = new ListingLaunch({ shopId: '660000000000000000000001', salesChannelCode: 'AMAZON', marketplaceCode: 'amazon_us', brief: 'Floral tee' });
  expect(draft.validateSync()).toBeUndefined();
  expect(draft.state).toBe('BRIEF');
  expect(draft.marketplaceCode).toBe('AMAZON_US');
  expect(draft.referenceAssetIds).toEqual([]);
  expect(draft.internalTemplateId).toBeNull();
  expect(ListingLaunch.schema.path('salesChannelCode').enumValues).toEqual(['AMAZON']);
  expect(ListingLaunch.schema.path('state').enumValues).toEqual(['BRIEF', 'PRODUCT_SELECTED']);
  expect(ListingLaunch.schema.indexes()).toEqual(expect.arrayContaining([
    [{ shopId: 1, state: 1, updatedAt: -1, _id: -1 }, {}],
    [{ shopId: 1, updatedAt: -1, _id: -1 }, {}],
  ]));
});

test('schema rejects absent required fields and unsupported values', () => {
  expect(new ListingLaunch().validateSync().errors).toHaveProperty('brief');
  expect(new ListingLaunch({ salesChannelCode: 'ETSY', state: 'EXPORTED' }).validateSync().errors).toHaveProperty('state');
});
