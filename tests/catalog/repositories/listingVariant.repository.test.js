jest.mock('../../../src/modules/catalog/models/listingVariant.model', () => ({
  aggregate: jest.fn(),
}));

const ListingVariant = require('../../../src/modules/catalog/models/listingVariant.model');
const repository = require('../../../src/modules/catalog/repositories/listingVariant.repository');

describe('listingVariant.repository', () => {
  test('countByListings casts string listing ids for aggregate matching', async () => {
    const listingId = '660000000000000000000401';
    ListingVariant.aggregate.mockResolvedValue([{ _id: listingId, count: 2 }]);

    const result = await repository.countByListings([listingId]);

    expect(ListingVariant.aggregate).toHaveBeenCalledWith([
      { $match: { listingId: { $in: [expect.objectContaining({ _bsontype: 'ObjectId' })] } } },
      { $group: { _id: '$listingId', count: { $sum: 1 } } },
    ]);
    expect(result.get(listingId)).toBe(2);
  });
});
