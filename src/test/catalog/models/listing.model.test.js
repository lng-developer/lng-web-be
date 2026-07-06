const Listing = require('../../../modules/catalog/models/listing.model');

describe('Listing model', () => {
  test('scopes SKU uniqueness by shop/channel/marketplace', () => {
    const uniqueIndexes = Listing.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => fields);

    expect(uniqueIndexes).toContainEqual({
      shopId: 1,
      salesChannelCode: 1,
      marketplaceCode: 1,
      sku: 1,
    });
  });

  test('baseCostAmount requires integer minor units', async () => {
    const listing = new Listing({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: '660000000000000000000301',
      baseCostAmount: 12.34,
    });

    await expect(listing.validate()).rejects.toThrow('baseCostAmount must be an integer minor unit value');
  });

  test('baseCostAmount rejects negative values', async () => {
    const listing = new Listing({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: '660000000000000000000301',
      baseCostAmount: -1,
    });

    await expect(listing.validate()).rejects.toThrow();
  });

  test('asin is optional and indexed by shop/channel/marketplace', () => {
    const asinPath = Listing.schema.path('asin');
    const indexes = Listing.schema.indexes().map(([fields]) => fields);

    expect(asinPath.options.uppercase).toBe(true);
    expect(asinPath.options.trim).toBe(true);
    expect(indexes).toContainEqual({
      shopId: 1,
      salesChannelCode: 1,
      marketplaceCode: 1,
      asin: 1,
    });
  });

  test('etsyListingId is optional and indexed by shop/channel/marketplace', () => {
    const etsyListingIdPath = Listing.schema.path('etsyListingId');
    const indexes = Listing.schema.indexes().map(([fields]) => fields);

    expect(etsyListingIdPath.options.trim).toBe(true);
    expect(indexes).toContainEqual({
      shopId: 1,
      salesChannelCode: 1,
      marketplaceCode: 1,
      etsyListingId: 1,
    });
  });

  test('qcStatus defaults to DRAFT', () => {
    const qcStatusPath = Listing.schema.path('qcStatus');

    expect(qcStatusPath.options.default).toBe('DRAFT');
    expect(qcStatusPath.enumValues).toEqual(expect.arrayContaining(['DRAFT', 'APPROVED', 'REJECTED']));
  });
});
