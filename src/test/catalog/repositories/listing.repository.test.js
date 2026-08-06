jest.mock('../../../modules/catalog/models/listing.model', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

const Listing = require('../../../modules/catalog/models/listing.model');
const repository = require('../../../modules/catalog/repositories/listing.repository');

function chain() {
  return {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  };
}

describe('listing.repository', () => {
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
    Listing.countDocuments
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1);

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
    });
    expect(Listing.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ salesChannelCode: 'AMAZON' }));
    expect(Listing.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ salesChannelCode: 'ETSY' }));
    expect(Listing.countDocuments).toHaveBeenCalledTimes(6);
  });
});
