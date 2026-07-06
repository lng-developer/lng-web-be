jest.mock('../../../modules/order/models/order.model', () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
}));

const Order = require('../../../modules/order/models/order.model');
const repository = require('../../../modules/order/repositories/order.repository');

function listItemsPipeline() {
  const pipeline = Order.aggregate.mock.calls
    .map(([value]) => value)
    .find((value) => (
      value.some((stage) => stage.$facet)
      || (value.some((stage) => stage.$sort) && value.some((stage) => stage.$limit))
    ));
  const facet = pipeline.find((stage) => stage.$facet);
  return facet ? facet.$facet.items : pipeline;
}

describe('order.repository list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Order.aggregate.mockImplementation(async (pipeline = []) => {
      if (pipeline.some((stage) => stage.$facet)) {
        return [{
          items: [{
            _id: '660000000000000000000301',
            externalOrderId: '114-1',
            itemsCount: 2,
            totalAmount: 3530,
          }],
          tabCounts: [{
            ALL: 3,
            NEW_ORDER: 3,
            NO_COST_CENTER: 3,
            NO_PSD: 3,
            PAYMENT_PENDING: 3,
            IN_PROGRESS: 3,
            SHIPPED: 3,
            DELIVERED: 3,
            CANCELLED: 3,
            OPEN_CASE: 3,
          }],
        }];
      }

      if (pipeline.some((stage) => stage.$group)) {
        return [{
          ALL: 3,
          NEW_ORDER: 3,
          NO_COST_CENTER: 3,
          NO_PSD: 3,
          PAYMENT_PENDING: 3,
          IN_PROGRESS: 3,
          SHIPPED: 3,
          DELIVERED: 3,
          CANCELLED: 3,
          OPEN_CASE: 3,
        }];
      }

      return [{
        _id: '660000000000000000000301',
        externalOrderId: '114-1',
        itemsCount: 2,
        totalAmount: 3530,
      }];
    });
    Order.countDocuments.mockResolvedValue(3);
  });

  test('applies tab, filters, multi-sort, pagination, and tab counts', async () => {
    const result = await repository.list({
      page: 2,
      limit: 10,
      tab: 'NO_PSD',
      orderId: '114',
      shopId: '660000000000000000000201',
      seller: 'SELLER-1',
      status: 'IMPORTED',
      assignedStaffId: '660000000000000000000901',
      dateFrom: new Date('2026-06-01T00:00:00.000Z'),
      dateTo: new Date('2026-06-30T23:59:59.000Z'),
      sort: '-orderedAt,externalOrderId',
    });

    expect(Order.aggregate).toHaveBeenCalledTimes(1);
    const pipeline = listItemsPipeline();
    expect(String(pipeline[0].$match.shopId)).toBe('660000000000000000000201');
    expect(String(pipeline[0].$match.assignedStaffId)).toBe('660000000000000000000901');
    expect(pipeline[0].$match).toMatchObject({
      status: 'IMPORTED',
      psdStatus: { $in: ['MISSING', null] },
      externalAccountId: 'SELLER-1',
      externalOrderId: { $regex: '114', $options: 'i' },
    });
    expect(pipeline.slice(0, 5)).toEqual([
      expect.objectContaining({ $match: expect.any(Object) }),
      { $sort: { orderedAt: -1, externalOrderId: 1, _id: 1 } },
      { $skip: 10 },
      { $limit: 10 },
      expect.objectContaining({ $lookup: expect.any(Object) }),
    ]);
    expect(Order.countDocuments).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      total: 3,
      page: 2,
      limit: 10,
      tabCounts: expect.objectContaining({
        ALL: 3,
        NO_PSD: 3,
      }),
      items: [expect.objectContaining({
        externalOrderId: '114-1',
        itemsCount: 2,
        totalAmount: 3530,
      })],
    });
  });

  test('uses delivered tab filter without changing order status', async () => {
    await repository.list({ tab: 'DELIVERED' });

    expect(Order.aggregate).toHaveBeenCalledTimes(1);
    const pipeline = listItemsPipeline();
    expect(pipeline[0]).toEqual({
      $match: expect.objectContaining({
        deliveredAt: { $exists: true, $ne: null },
      }),
    });
  });

  test('search matches order buyer and item sku/title before pagination', async () => {
    await repository.list({ search: 'nurse' });

    const pipeline = Order.aggregate.mock.calls
      .map(([value]) => value)
      .find((value) => value.some((stage) => stage.$sort) && value.some((stage) => stage.$limit));
    expect(pipeline[0]).toEqual(expect.objectContaining({
      $lookup: expect.objectContaining({ from: 'orderitems' }),
    }));
    expect(pipeline[1]).toEqual({
      $match: expect.objectContaining({
        $or: expect.arrayContaining([
          { externalOrderId: { $regex: 'nurse', $options: 'i' } },
          { 'buyer.name': { $regex: 'nurse', $options: 'i' } },
          { 'buyer.emailMasked': { $regex: 'nurse', $options: 'i' } },
          { 'items.sku': { $regex: 'nurse', $options: 'i' } },
          { 'items.title': { $regex: 'nurse', $options: 'i' } },
        ]),
      }),
    });
    expect(pipeline[2]).toEqual({ $sort: { orderedAt: -1, _id: -1 } });
  });

  test('casts shop id filters for aggregate pipelines', async () => {
    await repository.list({
      shopIds: ['660000000000000000000201'],
    });

    const pipeline = listItemsPipeline();
    expect(pipeline[0].$match.shopId.$in[0]).toMatchObject({
      _bsontype: 'ObjectId',
    });
  });

  test('counts tabs with one aggregate when search is absent', async () => {
    Order.aggregate.mockResolvedValueOnce([{
      ALL: 10,
      NEW_ORDER: 4,
      NO_COST_CENTER: 2,
      NO_PSD: 3,
      PAYMENT_PENDING: 1,
      IN_PROGRESS: 2,
      SHIPPED: 1,
      DELIVERED: 1,
      CANCELLED: 0,
      OPEN_CASE: 1,
    }]);

    const result = await repository.countByTabs({ shopId: '660000000000000000000201' });

    expect(Order.aggregate).toHaveBeenCalledTimes(1);
    const pipeline = Order.aggregate.mock.calls[0][0];
    expect(String(pipeline[0].$match.shopId)).toBe('660000000000000000000201');
    expect(pipeline[1]).toEqual(expect.objectContaining({ $group: expect.any(Object) }));
    expect(pipeline[2]).toEqual(expect.objectContaining({ $project: expect.any(Object) }));
    expect(Order.countDocuments).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ALL: 10,
      NEW_ORDER: 4,
      NO_PSD: 3,
    });
  });
});
