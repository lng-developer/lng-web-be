jest.mock('../../../src/modules/order/models/orderWorkbenchProjection.model', () => ({
  aggregate: jest.fn(),
  findOneAndUpdate: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

const OrderWorkbenchProjection = require('../../../src/modules/order/models/orderWorkbenchProjection.model');
const repository = require('../../../src/modules/order/repositories/orderWorkbenchProjection.repository');

describe('orderWorkbenchProjection.repository', () => {
  test('base refresh atomically merges existing item enrichments instead of resetting them', async () => {
    await repository.upsertBase({ orderId: 'o', shop: null, case: null, hasCurrentPsd: false, items: [{ orderItemId: 'i', item: { sku: 'NEW' } }] }, { preserveEnrichment: true });
    const update = OrderWorkbenchProjection.findOneAndUpdate.mock.calls[0][1];
    expect(Array.isArray(update)).toBe(true);
    expect(update[0].$set).not.toHaveProperty('case');
    expect(update[0].$set.hasCurrentPsd).toEqual({ $ifNull: ['$hasCurrentPsd', false] });
    expect(update[0].$set.items.$map.in.$mergeObjects).toHaveLength(3);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    OrderWorkbenchProjection.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ orderId: 'order-1' }) });
  });

  test('patches only the requested item subtree', async () => {
    await repository.setItemFields('order-1', 'item-1', { production: { qcStatus: 'APPROVED' } });

    expect(OrderWorkbenchProjection.findOneAndUpdate).toHaveBeenCalledWith(
      { orderId: 'order-1' },
      { $set: { 'items.$[item].production': { qcStatus: 'APPROVED' } } },
      expect.objectContaining({
        arrayFilters: [{ 'item.orderItemId': 'item-1' }],
        returnDocument: 'after',
      }),
    );
  });

  test('image patch cannot attach to a projection refreshed with another source', async () => {
    await repository.setItemFields('order-1', 'item-1', { 'item.listingImageAssetId': 'asset' }, { expectedListingImageUrl: 'https://i.etsystatic.com/old.jpg' });
    expect(OrderWorkbenchProjection.findOneAndUpdate).toHaveBeenCalledWith(
      { orderId: 'order-1' }, expect.anything(), expect.objectContaining({
        arrayFilters: [{ 'item.orderItemId': 'item-1', 'item.item.listingImageUrl': 'https://i.etsystatic.com/old.jpg' }],
      }),
    );
  });

  test('reads a paginated projection page with the workbench default ordering', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ orderId: 'order-1' }]),
    };
    OrderWorkbenchProjection.find.mockReturnValue(chain);
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(7);

    const result = await repository.findPage({ page: 2, limit: 3, tab: 'ALL' });

    expect(OrderWorkbenchProjection.find).toHaveBeenCalledWith({});
    expect(chain.skip).toHaveBeenCalledWith(3);
    expect(result).toEqual({ items: [{ orderId: 'order-1' }], total: 7, page: 2, limit: 3 });
  });

  test('filters and counts New orders by orderedAt from the last 24 hours', async () => {
    const now = new Date('2026-09-05T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const chain = {
      sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]),
    };
    OrderWorkbenchProjection.find.mockReturnValue(chain);
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(0);
    OrderWorkbenchProjection.aggregate.mockResolvedValue([{}]);

    await repository.findPage({ tab: 'NEW_ORDER' });
    await repository.countByTabs();

    expect(OrderWorkbenchProjection.find).toHaveBeenCalledWith({
      orderedAt: { $gte: new Date('2026-09-04T12:00:00.000Z') },
    });
    const group = OrderWorkbenchProjection.aggregate.mock.calls[0][0].find((stage) => stage.$group).$group;
    expect(group.NEW_ORDER).toEqual({
      $sum: { $cond: [{ $gte: ['$orderedAt', new Date('2026-09-04T12:00:00.000Z')] }, 1, 0] },
    });
    jest.useRealTimers();
  });

  test('applies workbench tab, search, and item filters without joins', async () => {
    OrderWorkbenchProjection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]),
    });
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(0);

    await repository.findPage({
      tab: 'NEEDS_MAPPING', search: 'nurse', employeeCode: 'J2501', vendorId: 'vendor-1',
    });

    expect(OrderWorkbenchProjection.find).toHaveBeenCalledWith(expect.objectContaining({
      'items.item.status': 'MAPPING_PENDING',
      'items.item.sku': { $regex: '^J2501-', $options: 'i' },
      $or: expect.arrayContaining([
        { externalOrderId: { $regex: 'nurse', $options: 'i' } },
        { 'items.item.title': { $regex: 'nurse', $options: 'i' } },
      ]),
    }));
  });

  test('uses source order timestamps for historical filters and sorting', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]),
    };
    OrderWorkbenchProjection.find.mockReturnValue(chain);
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(0);

    await repository.findPage({ createdAtFrom: '2026-09-01', sort: '-createdAt' });

    expect(OrderWorkbenchProjection.find).toHaveBeenCalledWith({ sourceCreatedAt: { $gte: '2026-09-01' } });
    expect(chain.sort).toHaveBeenCalledWith({ sourceCreatedAt: -1, _id: 1 });
  });

  test('matches the current PSD tab using the persisted current-readiness result', async () => {
    OrderWorkbenchProjection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]),
    });
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(0);

    await repository.findPage({ tab: 'NO_PSD' });

    expect(OrderWorkbenchProjection.find).toHaveBeenCalledWith({ hasCurrentPsd: false });
  });

  test('counts all workbench tabs from projection rows without lookups', async () => {
    OrderWorkbenchProjection.aggregate.mockResolvedValueOnce([{ ALL: 7, NO_PSD: 2, NEEDS_MAPPING: 1 }]);

    const result = await repository.countByTabs({
      shopIds: ['shop-1'],
      search: 'nurse',
      employeeCode: 'J2501',
      vendorId: 'vendor-1',
    });

    expect(OrderWorkbenchProjection.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      {
        $match: expect.objectContaining({
          shopId: { $in: ['shop-1'] },
          'items.item.sku': { $regex: '^J2501-', $options: 'i' },
          $or: expect.any(Array),
          $and: expect.any(Array),
        }),
      },
      expect.objectContaining({ $group: expect.any(Object) }),
      { $project: { _id: 0 } },
    ]));
    const pipeline = OrderWorkbenchProjection.aggregate.mock.calls[0][0];
    expect(pipeline.find((stage) => stage.$group).$group.DELIVERED).toEqual({
      $sum: { $cond: [{ $ne: [{ $ifNull: ['$deliveredAt', null] }, null] }, 1, 0] },
    });
    expect(result).toEqual(expect.objectContaining({ ALL: 7, NO_PSD: 2, NEEDS_MAPPING: 1 }));
  });
});
