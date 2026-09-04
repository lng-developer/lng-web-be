jest.mock('../../../src/modules/catalog/models/listingVariant.model', () => ({
  aggregate: jest.fn(),
}));

const ListingVariant = require('../../../src/modules/catalog/models/listingVariant.model');
const repository = require('../../../src/modules/catalog/repositories/listingVariant.repository');

describe('listingVariant.repository', () => {
  test('summarizeByListings returns count and PSD readiness from one aggregate', async () => {
    const listingId = '660000000000000000000401';
    ListingVariant.aggregate.mockResolvedValue([{ _id: listingId, count: 2, ready: 1 }]);

    const result = await repository.summarizeByListings([listingId]);

    expect(ListingVariant.aggregate).toHaveBeenCalledWith([
      { $match: { listingId: { $in: [expect.objectContaining({ _bsontype: 'ObjectId' })] } } },
      {
        $group: {
          _id: '$listingId',
          count: { $sum: 1 },
          ready: { $sum: { $cond: [{ $ifNull: ['$psdTemplateAssetId', false] }, 1, 0] } },
        },
      },
    ]);
    expect(result.get(listingId)).toEqual({ count: 2, ready: 1 });
  });
});
