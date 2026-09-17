jest.mock('../../../src/modules/mapping/models/fulfillmentPlan.model', () => ({
  aggregate: jest.fn(),
  find: jest.fn(),
  updateMany: jest.fn(),
}));

const FulfillmentPlan = require('../../../src/modules/mapping/models/fulfillmentPlan.model');
const repository = require('../../../src/modules/mapping/repositories/fulfillmentPlan.repository');

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
      { $lookup: { from: 'orderitems', localField: 'orderItemId', foreignField: '_id', as: '_orderItem' } },
      { $match: { '_orderItem.0': { $exists: true } } },
      { $unset: '_orderItem' },
      { $sort: { updatedAt: -1, _id: -1 } },
      { $facet: { items: [{ $skip: 1 }, { $limit: 1 }], total: [{ $count: 'count' }] } },
    ]));
  });

  test('summarize returns status, selection, blocker, and pipeline-stage counts from one aggregation', async () => {
    FulfillmentPlan.aggregate.mockResolvedValueOnce([{
      total: [{ count: 4 }],
      byStatus: [{ _id: 'BLOCKED', count: 3 }, { _id: 'READY', count: 1 }],
      bySelectionMode: [{ _id: 'AUTO', count: 1 }],
      byBlockingReason: [{ _id: 'LISTING_NOT_FOUND', count: 2 }],
      byStage: [{ _id: 'PRODUCT_MAPPING', count: 2 }],
    }]);

    await expect(repository.summarize({})).resolves.toEqual({
      total: 4,
      byStatus: { BLOCKED: 3, READY: 1 },
      bySelectionMode: { AUTO: 1 },
      byBlockingReason: { LISTING_NOT_FOUND: 2 },
      byStage: { PRODUCT_MAPPING: 2 },
    });
    expect(FulfillmentPlan.aggregate.mock.calls[0][0]).toEqual(expect.arrayContaining([
      { $lookup: { from: 'orderitems', localField: 'orderItemId', foreignField: '_id', as: '_orderItem' } },
      { $match: { '_orderItem.0': { $exists: true } } },
      { $unset: '_orderItem' },
    ]));
  });

  test('batch plan reads include listing variant identity for PSD readiness', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const select = jest.fn().mockReturnValue({ lean });
    FulfillmentPlan.find.mockReturnValueOnce({ select });

    await repository.listByOrderItemIds(['660000000000000000001001']);

    expect(select).toHaveBeenCalledWith(expect.stringContaining('listingVariantId'));
  });

  test('lists plan status for a catalog merge candidate', async () => {
    const lean = jest.fn().mockResolvedValue([{ _id: 'plan-1', status: 'READY' }]);
    const select = jest.fn().mockReturnValue({ lean });
    FulfillmentPlan.find.mockReturnValueOnce({ select });

    await expect(repository.listByListingId('660000000000000000001101')).resolves.toEqual([
      { _id: 'plan-1', status: 'READY' },
    ]);
    expect(select).toHaveBeenCalledWith('_id status');
  });

  test('relinks catalog merge plans in the supplied transaction', async () => {
    const session = {};
    FulfillmentPlan.updateMany.mockResolvedValueOnce({ modifiedCount: 2 });

    await expect(repository.relinkPlansForCatalogMerge({
      fromListingId: '660000000000000000001101',
      toListingId: '660000000000000000001102',
      listing: { id: '660000000000000000001102', sku: 'SKU-1', title: 'Canonical' },
    }, { session })).resolves.toEqual({ modifiedCount: 2 });
    expect(FulfillmentPlan.updateMany).toHaveBeenCalledWith(
      { listingId: expect.anything() },
      expect.objectContaining({ $set: expect.objectContaining({ listingId: expect.anything(), 'snapshot.listing.sku': 'SKU-1' }) }),
      { session },
    );
  });
});
