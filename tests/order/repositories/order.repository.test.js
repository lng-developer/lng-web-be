jest.mock('../../../src/modules/order/models/order.model', () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
  findOne: jest.fn(),
}));

const Order = require('../../../src/modules/order/models/order.model');
const repository = require('../../../src/modules/order/repositories/order.repository');

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
      vendorId: '660000000000000000000301',
      seller: 'SELLER-1',
      status: 'IMPORTED',
      costCenterStatus: 'PRESENT',
      addressValidationStatus: 'VALID',
      caseStatus: 'OPEN',
      assignedStaffIds: ['660000000000000000000901'],
      dateFrom: new Date('2026-06-01T00:00:00.000Z'),
      dateTo: new Date('2026-06-30T23:59:59.000Z'),
      createdAtFrom: new Date('2026-06-02T00:00:00.000Z'),
      createdAtTo: new Date('2026-06-29T23:59:59.000Z'),
      sort: '-orderedAt,externalOrderId',
    });

    expect(Order.aggregate).toHaveBeenCalledTimes(1);
    const pipeline = listItemsPipeline();
    const matchStage = pipeline.find((stage) => stage.$match?.shopId);
    expect(String(matchStage.$match.shopId)).toBe('660000000000000000000201');
    expect(matchStage.$match.assignedStaffIds.$in.map(String)).toEqual(['660000000000000000000901']);
    expect(matchStage.$match).toMatchObject({
      status: 'IMPORTED',
      costCenterStatus: 'PRESENT',
      addressValidationStatus: 'VALID',
      caseStatus: 'OPEN',
      externalAccountId: 'SELLER-1',
      externalOrderId: { $regex: '114', $options: 'i' },
      createdAt: {
        $gte: new Date('2026-06-02T00:00:00.000Z'),
        $lte: new Date('2026-06-29T23:59:59.000Z'),
      },
    });
    expect(matchStage.$match.hasCurrentPsd).toBe(false);
    expect(pipeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ $lookup: expect.objectContaining({ from: 'listingvariants' }) }),
      expect.objectContaining({ $lookup: expect.objectContaining({ from: 'internaltemplates' }) }),
    ]));
    expect(pipeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ $match: expect.objectContaining({
        shopId: expect.any(Object),
        $or: [
          { 'fulfillmentPlans.snapshot.vendor.id': '660000000000000000000301' },
          { 'fulfillmentPlans.snapshot.vendorProduct.vendor.id': '660000000000000000000301' },
        ],
      }) }),
      { $sort: { orderedAt: -1, externalOrderId: 1, _id: 1 } },
      { $skip: 10 },
      { $limit: 10 },
    ]));
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

  test('uses address issue tab for orders that still need address handling', async () => {
    await repository.list({ tab: 'ADDRESS_ISSUE' });

    const pipeline = listItemsPipeline();
    expect(pipeline[0]).toEqual({
      $match: expect.objectContaining({
        addressValidationStatus: { $nin: ['VALID', 'OVERRIDDEN'] },
      }),
    });
  });

  test('filters operational queues by item status before pagination', async () => {
    await repository.list({ tab: 'SENT_TO_VENDOR', includeTabCounts: false });

    const pipeline = listItemsPipeline();
    expect(pipeline[0]).toEqual(expect.objectContaining({
      $lookup: expect.objectContaining({ from: 'orderitems' }),
    }));
    expect(pipeline[1]).toEqual({
      $match: {
        'items.status': 'SENT_TO_VENDOR',
      },
    });

    await repository.list({ tab: 'TRACKING_PENDING', includeTabCounts: false });

    expect(Order.aggregate.mock.calls.at(-1)[0][1]).toEqual({
      $match: {
        'items.status': 'TRACKING_PENDING',
      },
    });
  });

  test('skips all tab counts when includeTabCounts is false', async () => {
    Order.aggregate.mockReset()
      .mockResolvedValueOnce([{ total: 3 }])
      .mockResolvedValueOnce([{
        _id: '660000000000000000000301', externalOrderId: '114-1', itemsCount: 2, totalAmount: 3530,
      }]);
    const result = await repository.list({ tab: 'NO_PSD', includeTabCounts: false });

    expect(Order.aggregate).toHaveBeenCalledTimes(2);
    expect(Order.countDocuments).not.toHaveBeenCalled();
    expect(Order.aggregate.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ $match: expect.objectContaining({ hasCurrentPsd: false }) }),
    ]));
    expect(Order.aggregate.mock.calls[0][0].some((stage) => stage.$facet)).toBe(false);
    expect(result).toMatchObject({
      total: 3,
      page: 1,
      limit: 20,
    });
    expect(result).not.toHaveProperty('tabCounts');
  });

  test('lists workbench page and exact total with one root facet', async () => {
    Order.aggregate.mockResolvedValueOnce([{
      items: [{ _id: 'order-1', items: [] }],
      total: [{ count: 7 }],
    }]);

    const result = await repository.listWorkbench({ page: 2, limit: 3 });

    expect(result).toEqual({
      items: [{ _id: 'order-1', items: [] }],
      total: 7,
      page: 2,
      limit: 3,
    });
    expect(Order.aggregate).toHaveBeenCalledTimes(1);
    expect(Order.countDocuments).not.toHaveBeenCalled();
    const pipeline = Order.aggregate.mock.calls[0][0];
    expect(pipeline).toEqual([{ $match: {} }, {
      $facet: expect.objectContaining({
        items: expect.arrayContaining([
          { $sort: { orderedAt: -1, _id: -1 } },
          { $skip: 3 },
          { $limit: 3 },
        ]),
        total: [{ $count: 'count' }],
      }),
    }]);
  });

  test('filters and counts New orders by orderedAt from the last 24 hours', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    Order.aggregate.mockResolvedValueOnce([{ items: [], total: [{ count: 0 }] }]).mockResolvedValueOnce([{}]);

    await repository.listWorkbench({ tab: 'NEW_ORDER' });
    await repository.countByTabs();

    expect(Order.aggregate.mock.calls[0][0][0]).toEqual({
      $match: { orderedAt: { $gte: new Date('2026-09-04T12:00:00.000Z') } },
    });
    const group = Order.aggregate.mock.calls[1][0].find((stage) => stage.$group).$group;
    expect(group.NEW_ORDER).toEqual({
      $sum: { $cond: [{ $gte: ['$orderedAt', new Date('2026-09-04T12:00:00.000Z')] }, 1, 0] },
    });
    jest.useRealTimers();
  });

  test('filters workbench orders by both current and legacy vendor snapshots', async () => {
    await repository.listWorkbench({ vendorId: '660000000000000000000301' });

    const [pipeline] = Order.aggregate.mock.calls.at(-1);
    const vendorFilter = {
      $or: [
        { 'fulfillmentPlans.snapshot.vendor.id': '660000000000000000000301' },
        { 'fulfillmentPlans.snapshot.vendorProduct.vendor.id': '660000000000000000000301' },
      ],
    };
    expect(pipeline).toEqual(expect.arrayContaining([{ $match: expect.objectContaining(vendorFilter) }]));
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
          { 'items.asin': { $regex: 'nurse', $options: 'i' } },
          { 'items.title': { $regex: 'nurse', $options: 'i' } },
        ]),
      }),
    });
    expect(pipeline[2]).toEqual({ $sort: { orderedAt: -1, _id: -1 } });
  });

  test('employee code matches item sku prefix before pagination and counts', async () => {
    await repository.list({ employeeCode: 'J2508' });

    const pipeline = Order.aggregate.mock.calls
      .map(([value]) => value)
      .find((value) => value.some((stage) => stage.$sort) && value.some((stage) => stage.$limit));
    expect(pipeline[0]).toEqual(expect.objectContaining({
      $lookup: expect.objectContaining({ from: 'orderitems' }),
    }));
    expect(pipeline[1]).toEqual({
      $match: {
        'items.sku': { $regex: '^J2508-', $options: 'i' },
      },
    });
    expect(Order.countDocuments).not.toHaveBeenCalled();
    expect(Order.aggregate.mock.calls.length).toBeGreaterThan(1);
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
    expect(pipeline[1]).toEqual(expect.objectContaining({
      $lookup: expect.objectContaining({ from: 'orderitems' }),
    }));
    const groupStage = pipeline.find((stage) => stage.$group);
    const projectStage = pipeline.find((stage) => stage.$project);
    expect(groupStage).toEqual(expect.objectContaining({ $group: expect.any(Object) }));
    expect(projectStage).toEqual(expect.objectContaining({ $project: expect.any(Object) }));
    expect(groupStage.$group).toEqual(expect.objectContaining({
      SENT_TO_VENDOR: expect.any(Object),
      TRACKING_PENDING: expect.any(Object),
      DELIVERED: {
        $sum: { $cond: [{ $ne: [{ $ifNull: ['$deliveredAt', null] }, null] }, 1, 0] },
      },
    }));
    expect(Order.countDocuments).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ALL: 10,
      NEW_ORDER: 4,
      NO_PSD: 3,
    });
  });

  test('keeps same external buyer IDs from two shops as separate first-order source buyers', async () => {
    await repository.summarizeNewBuyersByChannel({
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-31T23:59:59.999Z',
    });

    const pipeline = Order.aggregate.mock.calls.at(-1)[0];
    const buyerGroupIndex = pipeline.findIndex((stage) => stage.$group);
    const buyerGroup = pipeline[buyerGroupIndex].$group;
    const itemLookup = pipeline.find((stage) => stage.$lookup)?.$lookup;
    const aggregateGroup = pipeline.findLast((stage) => stage.$group).$group;
    const projection = pipeline.find((stage) => stage.$project).$project;

    expect(pipeline[buyerGroupIndex - 1]).toEqual({ $sort: { orderedAt: 1, _id: 1 } });
    expect(buyerGroup).toEqual({
      _id: {
        shopId: '$shopId',
        salesChannelCode: '$salesChannelCode',
        marketplaceCode: '$marketplaceCode',
        externalBuyerId: '$buyer.externalBuyerId',
      },
      firstOrderId: { $first: '$_id' },
      firstOrderAt: { $first: '$orderedAt' },
    });
    expect(itemLookup).toEqual({
      from: 'orderitems',
      let: { orderId: '$firstOrderId' },
      pipeline: [
        { $match: { $expr: { $eq: ['$orderId', '$$orderId'] } } },
        { $sort: { createdAt: 1, _id: 1 } },
        { $limit: 1 },
        { $project: { _id: 0, currency: '$price.currency' } },
      ],
      as: 'firstOrderItems',
    });
    expect(aggregateGroup._id).toEqual({
      salesChannelCode: '$_id.salesChannelCode',
      marketplaceCode: '$_id.marketplaceCode',
      currency: '$currency',
    });
    expect(projection).toEqual(expect.objectContaining({
      currency: '$_id.currency',
      newBuyerCount: 1,
    }));
    expect(projection).not.toHaveProperty('externalBuyerId');
    expect(projection).not.toHaveProperty('shopId');
  });
});

describe('order.repository findByFinanceIdentity', () => {
  test('scopes the external order identity to its shop and marketplace', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: '660000000000000000000301' });
    Order.findOne.mockReturnValue({ lean });

    await repository.findByFinanceIdentity({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'US',
      externalOrderId: '113-1287785-5723402',
    });

    expect(Order.findOne).toHaveBeenCalledWith({
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'US',
      externalOrderId: '113-1287785-5723402',
    });
  });
});
