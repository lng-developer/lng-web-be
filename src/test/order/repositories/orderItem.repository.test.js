jest.mock('../../../modules/order/models/orderItem.model', () => ({
  distinct: jest.fn(),
  aggregate: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
}));

const OrderItem = require('../../../modules/order/models/orderItem.model');
const repository = require('../../../modules/order/repositories/orderItem.repository');

const identity = {
  shopId: '660000000000000000000201',
  salesChannelCode: 'AMAZON',
  marketplaceCode: 'AMAZON_US',
  externalOrderId: '114-1',
  externalItemId: 'ITEM-1',
  sku: 'SKU-1',
};

function leanResult(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function listResult(value) {
  const lean = jest.fn().mockResolvedValue(value);
  return { limit: jest.fn().mockReturnValue({ lean }) };
}

describe('orderItem.repository findByFinanceIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('prefers an external item match over a mismatched SKU', async () => {
    const item = { _id: '660000000000000000000401', externalItemId: identity.externalItemId, sku: 'SKU-ACTUAL' };
    OrderItem.findOne.mockReturnValue(leanResult(item));

    await expect(repository.findByFinanceIdentity({ ...identity, sku: 'SKU-OTHER' })).resolves.toEqual(item);
    expect(OrderItem.findOne).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: identity.externalOrderId,
      externalItemId: identity.externalItemId,
    }));
    expect(OrderItem.findOne.mock.calls[0][0]).not.toHaveProperty('sku');
  });

  test('falls back to a unique SKU match when the external item code differs', async () => {
    const item = { _id: '660000000000000000000401', sku: identity.sku };
    OrderItem.findOne.mockReturnValue(leanResult(null));
    OrderItem.find.mockReturnValue(listResult([item]));

    await expect(repository.findByFinanceIdentity({ ...identity, externalItemId: 'WRONG-ITEM' })).resolves.toEqual(item);
    expect(OrderItem.find).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: identity.externalOrderId,
      sku: identity.sku,
    }));
  });

  test('does not link an ambiguous SKU match', async () => {
    OrderItem.findOne.mockReturnValue(leanResult(null));
    OrderItem.find.mockReturnValue(listResult([
      { _id: '660000000000000000000401', sku: identity.sku },
      { _id: '660000000000000000000402', sku: identity.sku },
    ]));

    await expect(repository.findByFinanceIdentity({ ...identity, externalItemId: 'WRONG-ITEM' })).resolves.toBeNull();
    expect(OrderItem.find).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: identity.externalOrderId,
      sku: identity.sku,
    }));
  });
});

describe('orderItem.repository findIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns all IDs matching the external order filter without pagination', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `order-item-${index + 1}`);
    OrderItem.distinct.mockResolvedValueOnce(ids);

    await expect(repository.findIds({ externalOrderId: '114-1' })).resolves.toEqual(ids);
    expect(OrderItem.distinct).toHaveBeenCalledWith('_id', {
      externalOrderId: { $regex: '114-1', $options: 'i' },
    });
  });

  test('searches order identity, SKU, and ASIN from one query', async () => {
    OrderItem.distinct.mockResolvedValueOnce([]);

    await repository.findIds({ q: 'DASH-ETSY-016' });

    expect(OrderItem.distinct).toHaveBeenCalledWith('_id', {
      $or: [
        { externalOrderId: { $regex: 'DASH-ETSY-016', $options: 'i' } },
        { externalItemId: { $regex: 'DASH-ETSY-016', $options: 'i' } },
        { sku: { $regex: 'DASH-ETSY-016', $options: 'i' } },
        { asin: { $regex: 'DASH-ETSY-016', $options: 'i' } },
      ],
    });
  });
});

describe('orderItem.repository findByIdWithOrder', () => {
  test('loads the item and its order in one aggregation', async () => {
    OrderItem.aggregate.mockResolvedValueOnce([{ _id: 'item-1', order: { _id: 'order-1' } }]);

    await expect(repository.findByIdWithOrder('660000000000000000000401')).resolves.toEqual({
      item: { _id: 'item-1' }, order: { _id: 'order-1' },
    });
    expect(OrderItem.aggregate).toHaveBeenCalledTimes(1);
    expect(OrderItem.aggregate.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ $match: expect.any(Object) }),
      expect.objectContaining({ $lookup: expect.objectContaining({ from: 'orders' }) }),
    ]));
  });
});

describe('orderItem.repository list', () => {
  test('returns a page and exact total from one facet aggregation', async () => {
    OrderItem.aggregate.mockResolvedValueOnce([{ items: [{ _id: 'item-1' }], total: [{ count: 5 }] }]);

    await expect(repository.list({ page: 2, limit: 2 })).resolves.toEqual({
      items: [{ _id: 'item-1' }], total: 5, page: 2, limit: 2,
    });
    expect(OrderItem.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $facet: { items: [{ $skip: 2 }, { $limit: 2 }], total: [{ $count: 'count' }] } },
    ]));
  });
});
