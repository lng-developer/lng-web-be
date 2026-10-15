jest.mock('../../../src/modules/catalog/models/listing.model', () => ({
  findOneAndUpdate: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}));

const Listing = require('../../../src/modules/catalog/models/listing.model');
const repository = require('../../../src/modules/catalog/repositories/listing.repository');

function chain() {
  return {
    populate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  };
}

describe('listing.repository', () => {
  test('general search matches Etsy listing IDs while preserving shop and channel scope', async () => {
    Listing.find.mockReturnValue(chain());
    Listing.countDocuments.mockResolvedValue(0);

    await repository.list({ shopId: 'shop-1', salesChannelCode: 'ETSY', search: ' 456156 ', page: 1, limit: 10 });

    const filter = Listing.find.mock.calls[0][0];
    expect(filter).toMatchObject({ shopId: 'shop-1', salesChannelCode: 'ETSY' });
    const idSearch = filter.$or.find((condition) => condition.etsyListingId)?.etsyListingId;
    expect(idSearch).toBeInstanceOf(RegExp);
    expect(idSearch.test('4561569753')).toBe(true);
    expect(idSearch.test('14561569753')).toBe(false);
    expect(Listing.countDocuments).toHaveBeenCalledWith(filter);
  });

  test('image enrichment atomically matches the shop and Etsy ID and never replaces an existing image', async () => {
    Listing.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    await repository.fillEtsyListingImage({ shopId: 'shop', marketplaceCode: 'ETSY_US', etsyListingId: '123', productImageUrl: 'https://i.etsystatic.com/a.jpg' });
    expect(Listing.findOneAndUpdate).toHaveBeenCalledWith({ shopId: 'shop', salesChannelCode: 'ETSY', marketplaceCode: 'ETSY_US', etsyListingId: '123', productImageUrl: { $in: [null, ''] } }, { $set: { productImageUrl: 'https://i.etsystatic.com/a.jpg' } }, expect.objectContaining({ runValidators: true }));
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('list builds supported filters', async () => {
    const query = chain();
    Listing.find.mockReturnValue(query);
    Listing.countDocuments.mockResolvedValue(0);

    await repository.list({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      etsyListingId: '1234567890',
      sku: 'SKU',
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
      psdState: 'missing',
      search: 'B0TEST',
      page: 1,
      limit: 20,
    });

    expect(Listing.find).toHaveBeenCalledWith(expect.objectContaining({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
      defaultPsdTemplateAssetId: null,
    }));
    expect(Listing.find.mock.calls[0][0].asin).toEqual(expect.any(RegExp));
    expect(Listing.find.mock.calls[0][0].etsyListingId).toEqual(expect.any(RegExp));
    expect(Listing.find.mock.calls[0][0].sku).toEqual(expect.any(RegExp));
    expect(Listing.find.mock.calls[0][0].$or).toEqual(expect.arrayContaining([
      expect.objectContaining({ asin: expect.any(RegExp) }),
      expect.objectContaining({ sku: expect.any(RegExp) }),
      expect.objectContaining({ title: expect.any(RegExp) }),
    ]));
  });

  test('summarize returns cross-platform listing counts', async () => {
    Listing.aggregate.mockResolvedValue([{
      totals: [{
        totalListingCount: 10,
        amazonListingCount: 6,
        etsyListingCount: 4,
        draftCount: 5,
        approvedCount: 4,
        rejectedCount: 1,
        noPsdCount: 2,
      }],
      channelCounts: [
        { code: 'AMAZON', count: 6 },
        { code: 'ETSY', count: 4 },
      ],
    }]);

    const result = await repository.summarize({
      shopId: '660000000000000000000201',
      productTypeGroupId: '660000000000000000000301',
    });

    expect(result).toEqual({
      totalListingCount: 10,
      amazonListingCount: 6,
      etsyListingCount: 4,
      draftCount: 5,
      approvedCount: 4,
      rejectedCount: 1,
      noPsdCount: 2,
      channelCounts: [
        { code: 'AMAZON', count: 6 },
        { code: 'ETSY', count: 4 },
      ],
    });
    expect(Listing.countDocuments).not.toHaveBeenCalled();
    expect(Listing.aggregate).toHaveBeenCalledTimes(1);
    expect(Listing.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $match: expect.objectContaining({ shopId: '660000000000000000000201' }) },
    ]));
  });

  test('summarize returns zero values when no listings match', async () => {
    Listing.aggregate.mockResolvedValue([{ totals: [], channelCounts: [] }]);

    await expect(repository.summarize({ shopId: '660000000000000000000201' })).resolves.toEqual({
      totalListingCount: 0,
      amazonListingCount: 0,
      etsyListingCount: 0,
      draftCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      noPsdCount: 0,
      channelCounts: [],
    });
  });
});
