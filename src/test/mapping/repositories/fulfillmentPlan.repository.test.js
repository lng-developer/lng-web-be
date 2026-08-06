jest.mock('../../../modules/mapping/models/fulfillmentPlan.model', () => ({
  aggregate: jest.fn(),
  find: jest.fn(),
}));

const FulfillmentPlan = require('../../../modules/mapping/models/fulfillmentPlan.model');
const repository = require('../../../modules/mapping/repositories/fulfillmentPlan.repository');

describe('fulfillmentPlan.repository read models', () => {
  beforeEach(() => jest.clearAllMocks());

  test('listUnmatched returns one facet page with an exact total', async () => {
    FulfillmentPlan.aggregate.mockResolvedValueOnce([{
      items: [{ orderItemId: '660000000000000000001001', blockingReasons: ['LISTING_NOT_FOUND'] }],
      total: [{ count: 3 }],
    }]);

    const result = await repository.listUnmatched({
      page: 2,
      limit: 1,
      blocker: 'LISTING_NOT_FOUND',
      q: 'AMZ-1',
    });

    expect(result).toEqual({
      items: [{ orderItemId: '660000000000000000001001', blockingReasons: ['LISTING_NOT_FOUND'] }],
      pagination: { total: 3, page: 2, limit: 1 },
    });
    const pipeline = FulfillmentPlan.aggregate.mock.calls[0][0];
    expect(pipeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ $match: expect.objectContaining({ status: 'BLOCKED', blockingReasons: 'LISTING_NOT_FOUND' }) }),
      { $sort: { updatedAt: -1, _id: -1 } },
      { $facet: { items: [{ $skip: 1 }, { $limit: 1 }], total: [{ $count: 'count' }] } },
    ]));
  });

  test('summarize returns status, selection, and blocker counts from one aggregation', async () => {
    FulfillmentPlan.aggregate.mockResolvedValueOnce([{
      total: [{ count: 4 }],
      byStatus: [{ _id: 'BLOCKED', count: 3 }, { _id: 'READY', count: 1 }],
      bySelectionMode: [{ _id: 'AUTO', count: 1 }],
      byBlockingReason: [{ _id: 'LISTING_NOT_FOUND', count: 2 }],
    }]);

    await expect(repository.summarize({})).resolves.toEqual({
      total: 4,
      byStatus: { BLOCKED: 3, READY: 1 },
      bySelectionMode: { AUTO: 1 },
      byBlockingReason: { LISTING_NOT_FOUND: 2 },
    });
  });

  test('batch plan reads include listing variant identity for PSD readiness', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const select = jest.fn().mockReturnValue({ lean });
    FulfillmentPlan.find.mockReturnValueOnce({ select });

    await repository.listByOrderItemIds(['660000000000000000001001']);

    expect(select).toHaveBeenCalledWith(expect.stringContaining('listingVariantId'));
  });
});
