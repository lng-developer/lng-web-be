const Listing = require('../../../src/modules/catalog/models/listing.model');
const { toListingDto } = require('../../../src/modules/catalog/dtos/listing.dto');
const {
  createListingSchema,
  updateListingSchema,
} = require('../../../src/modules/catalog/validators/listing.validator');

describe('Listing model', () => {
  test('indexes SKU lookup by shop/channel/marketplace without enforcing uniqueness', () => {
    const skuIndex = Listing.schema.indexes()
      .find(([fields]) => JSON.stringify(fields) === JSON.stringify({
        shopId: 1,
        salesChannelCode: 1,
        marketplaceCode: 1,
        sku: 1,
      }));

    expect(skuIndex).toBeTruthy();
    expect(skuIndex[1]?.unique).not.toBe(true);
  });

  test('enforces Amazon ASIN identity by channel/marketplace', () => {
    const asinIndex = Listing.schema.indexes()
      .find(([fields]) => JSON.stringify(fields) === JSON.stringify({
        salesChannelCode: 1,
        marketplaceCode: 1,
        asin: 1,
      }));

    expect(asinIndex).toBeTruthy();
    expect(asinIndex[1]?.unique).toBe(true);
    expect(asinIndex[1]?.partialFilterExpression).toEqual({
      salesChannelCode: 'AMAZON',
      asin: { $type: 'string', $gt: '' },
    });
  });

  test('does not enforce shop-scoped SKU identity', () => {
    const uniqueIndexes = Listing.schema.indexes()
      .filter(([, options]) => options?.unique)
      .map(([fields]) => fields);

    expect(uniqueIndexes).not.toContainEqual({
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

  test('asin is optional and indexed by channel/marketplace', () => {
    const asinPath = Listing.schema.path('asin');
    const indexes = Listing.schema.indexes().map(([fields]) => fields);

    expect(asinPath.options.uppercase).toBe(true);
    expect(asinPath.options.trim).toBe(true);
    expect(indexes).toContainEqual({
      salesChannelCode: 1,
      marketplaceCode: 1,
      asin: 1,
    });
    expect(Listing.schema.indexes()).toContainEqual([
      { salesChannelCode: 1, marketplaceCode: 1, asin: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: expect.objectContaining({
          asin: { $type: 'string', $gt: '' },
        }),
      }),
    ]);
  });

  test('etsyListingId is optional and indexed by channel/marketplace', () => {
    const etsyListingIdPath = Listing.schema.path('etsyListingId');
    const indexes = Listing.schema.indexes().map(([fields]) => fields);

    expect(etsyListingIdPath.options.trim).toBe(true);
    expect(indexes).toContainEqual({
      salesChannelCode: 1,
      marketplaceCode: 1,
      etsyListingId: 1,
    });
    expect(Listing.schema.indexes()).toContainEqual([
      { salesChannelCode: 1, marketplaceCode: 1, etsyListingId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: expect.objectContaining({
          etsyListingId: { $type: 'string', $gt: '' },
        }),
      }),
    ]);
  });

  test('qcStatus defaults to DRAFT', () => {
    const qcStatusPath = Listing.schema.path('qcStatus');

    expect(qcStatusPath.options.default).toBe('DRAFT');
    expect(qcStatusPath.enumValues).toEqual(expect.arrayContaining(['DRAFT', 'APPROVED', 'REJECTED']));
  });

  test('owns an optional default PSD template asset for listing-level fallback', () => {
    const defaultPsdPath = Listing.schema.path('defaultPsdTemplateAssetId');

    expect(defaultPsdPath).toBeTruthy();
    expect(defaultPsdPath.options.ref).toBe('MediaAsset');
    expect(defaultPsdPath.options.default).toBeNull();
  });

  test('does not own variant product and asset fields', () => {
    const legacyFields = [
      'productTypeGroupId',
      'internalTemplateId',
      'psdTemplateAssetId',
      'previewAssetId',
      'psdStatus',
      'costCenterStatus',
    ];

    legacyFields.forEach((field) => expect(Listing.schema.path(field)).toBeUndefined());

    const dto = toListingDto({
      _id: '660000000000000000000401',
      productTypeGroupId: '660000000000000000000301',
      internalTemplateId: '660000000000000000000302',
      psdTemplateAssetId: '660000000000000000000303',
      previewAssetId: '660000000000000000000304',
    });
    expect(Object.keys(dto)).not.toEqual(expect.arrayContaining([
      'productTypeGroup',
      'internalTemplate',
      'psdTemplateAssetId',
      'psdTemplateAsset',
      'previewAssetId',
      'previewAsset',
      'psdStatus',
      'costCenterStatus',
    ]));

    const payload = Object.fromEntries(legacyFields.map((field) => [field, '660000000000000000000301']));
    expect(createListingSchema.validate(payload).error).toBeTruthy();
    expect(updateListingSchema.validate(payload).error).toBeTruthy();
  });
});
