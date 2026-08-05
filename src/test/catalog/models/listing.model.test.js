const Listing = require('../../../modules/catalog/models/listing.model');
const { toListingDto } = require('../../../modules/catalog/dtos/listing.dto');
const {
  createListingSchema,
  updateListingSchema,
} = require('../../../modules/catalog/validators/listing.validator');

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

  test('does not own variant product and asset fields', () => {
    const legacyFields = [
      'productTypeGroupId',
      'internalTemplateId',
      'psdTemplateAssetId',
      'previewAssetId',
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
    ]));

    const payload = Object.fromEntries(legacyFields.map((field) => [field, '660000000000000000000301']));
    expect(createListingSchema.validate(payload).error).toBeTruthy();
    expect(updateListingSchema.validate(payload).error).toBeTruthy();
  });
});
