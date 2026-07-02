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
      productTypeGroupId: '660000000000000000000301',
      costCenterStatus: 'PRESENT',
      psdStatus: 'MISSING',
      page: 1,
      limit: 20,
    });

    expect(Listing.find).toHaveBeenCalledWith(expect.objectContaining({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
      productTypeGroupId: '660000000000000000000301',
      costCenterStatus: 'PRESENT',
      psdStatus: 'MISSING',
    }));
    expect(Listing.find.mock.calls[0][0].asin).toEqual(expect.any(RegExp));
    expect(Listing.find.mock.calls[0][0].etsyListingId).toEqual(expect.any(RegExp));
    expect(Listing.find.mock.calls[0][0].sku).toEqual(expect.any(RegExp));
  });
});
