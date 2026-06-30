jest.mock('../../../modules/order/models/order.model', () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
}));

const Order = require('../../../modules/order/models/order.model');
const repository = require('../../../modules/order/repositories/order.repository');

describe('order.repository list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Order.aggregate.mockResolvedValue([
      {
        _id: '660000000000000000000301',
        externalOrderId: '114-1',
        itemsCount: 2,
        totalAmount: 3530,
      },
    ]);
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

    const pipeline = Order.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({
      $match: expect.objectContaining({
        shopId: '660000000000000000000201',
        status: 'IMPORTED',
        psdStatus: { $in: ['MISSING', null] },
        externalAccountId: 'SELLER-1',
        assignedStaffId: '660000000000000000000901',
        externalOrderId: { $regex: '114', $options: 'i' },
      }),
    });
    expect(pipeline.slice(0, 5)).toEqual([
      expect.objectContaining({ $match: expect.any(Object) }),
      { $sort: { orderedAt: -1, externalOrderId: 1, _id: 1 } },
      { $skip: 10 },
      { $limit: 10 },
      expect.objectContaining({ $lookup: expect.any(Object) }),
    ]);
    expect(Order.countDocuments).toHaveBeenCalledWith(expect.objectContaining({
      psdStatus: { $in: ['MISSING', null] },
    }));
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

    expect(Order.aggregate.mock.calls[0][0][0]).toEqual({
      $match: expect.objectContaining({
        deliveredAt: { $exists: true, $ne: null },
      }),
    });
  });
});
