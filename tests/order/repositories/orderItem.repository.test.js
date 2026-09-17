jest.mock('../../../src/modules/order/models/orderItem.model', () => ({
  countDocuments: jest.fn(),
  distinct: jest.fn(),
  aggregate: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  updateMany: jest.fn(),
}));

const OrderItem = require('../../../src/modules/order/models/orderItem.model');
const repository = require('../../../src/modules/order/repositories/orderItem.repository');

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

  test('falls back to a unique order match when SKU and external item code are absent', async () => {
    const item = { _id: '660000000000000000000401', sku: 'SKU-1' };
    OrderItem.find.mockReturnValue(listResult([item]));

    await expect(repository.findByFinanceIdentity({
      ...identity,
      sku: null,
      externalItemId: null,
    })).resolves.toEqual(item);
    expect(OrderItem.find).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: identity.externalOrderId,
    }));
  });

  test('does not fall back to an ambiguous order match when SKU and external item code are absent', async () => {
    OrderItem.find.mockReturnValue(listResult([
      { _id: '660000000000000000000401', sku: 'SKU-1' },
      { _id: '660000000000000000000402', sku: 'SKU-2' },
    ]));

    await expect(repository.findByFinanceIdentity({
      ...identity,
      sku: null,
      externalItemId: null,
    })).resolves.toBeNull();
    expect(OrderItem.find).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: identity.externalOrderId,
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

describe('orderItem.repository listTopSalesByListing', () => {
  test('groups, sorts, and paginates the complete sales ranking', async () => {
    OrderItem.aggregate.mockResolvedValueOnce([{ items: [{ listingId: 'listing-1' }], total: [{ count: 61 }] }]);

    await expect(repository.listTopSalesByListing({
      shopId: identity.shopId,
      salesChannelCode: identity.salesChannelCode,
      sort: 'quantitySoldDesc',
      page: 2,
      limit: 24,
    })).resolves.toEqual({
      items: [{ listingId: 'listing-1' }], total: 61, page: 2, limit: 24,
    });

    expect(OrderItem.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      {
        $match: expect.objectContaining({
          shopId: identity.shopId,
          salesChannelCode: identity.salesChannelCode,
          $or: [{ listingId: { $ne: null } }, { asin: { $ne: null } }],
        }),
      },
      expect.objectContaining({ $group: expect.objectContaining({ _id: { $ifNull: ['$listingId', '$asin'] } }) }),
      { $sort: { quantitySold: -1, _id: 1 } },
      { $facet: { items: [{ $skip: 24 }, { $limit: 24 }], total: [{ $count: 'count' }] } },
    ]));
  });
});

describe('orderItem.repository catalog merge support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('finds only populated ASINs for one listing', async () => {
    OrderItem.distinct.mockResolvedValueOnce(['B0ONE', 'B0TWO']);

    await expect(repository.findDistinctAsinsByListingId('660000000000000000000501')).resolves.toEqual(['B0ONE', 'B0TWO']);
    expect(OrderItem.distinct).toHaveBeenCalledWith('asin', {
      listingId: expect.anything(),
      asin: { $type: 'string', $gt: '' },
    });
  });

  test('finds populated ASINs from a shop SKU history', async () => {
    OrderItem.distinct.mockResolvedValueOnce(['B0HISTORY']);

    await expect(repository.findDistinctAsins({
      shopId: identity.shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'US',
      sku: 'SKU-HISTORY',
    })).resolves.toEqual(['B0HISTORY']);
    expect(OrderItem.distinct).toHaveBeenCalledWith('asin', {
      shopId: expect.anything(),
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'US',
      sku: 'SKU-HISTORY',
      asin: { $type: 'string', $gt: '' },
    });
  });

  test('counts linked order items without exposing the model to catalog', async () => {
    OrderItem.countDocuments.mockResolvedValueOnce(3);

    await expect(repository.countByListingId('660000000000000000000501')).resolves.toBe(3);
    expect(OrderItem.countDocuments).toHaveBeenCalledWith({ listingId: expect.anything() });
  });

  test('relinks order items to the canonical listing inside a transaction', async () => {
    OrderItem.updateMany.mockResolvedValueOnce({ modifiedCount: 2 });
    const session = {};

    await expect(repository.relinkItemsForCatalogMerge({
      fromListingId: '660000000000000000000501',
      toListingId: '660000000000000000000502',
      asin: 'B0CANONICAL',
    }, { session })).resolves.toEqual({ modifiedCount: 2 });
    expect(OrderItem.updateMany).toHaveBeenCalledWith(
      { listingId: expect.anything() },
      { $set: { listingId: expect.anything(), asin: 'B0CANONICAL' } },
      { session },
    );
  });
});

describe('orderItem.repository sales summaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('summarizeSalesByAsins aggregates order item quantity through listing ASIN', async () => {
    OrderItem.aggregate.mockResolvedValueOnce([
      { asin: 'B0ASIN', orderCount: 2, orderItemCount: 3, quantitySold: 4 },
    ]);

    await expect(repository.summarizeSalesByAsins(['b0asin'])).resolves.toEqual([
      { asin: 'B0ASIN', orderCount: 2, orderItemCount: 3, quantitySold: 4 },
    ]);

    expect(OrderItem.aggregate.mock.calls[0][0]).toEqual(expect.arrayContaining([
      { $match: { listingId: { $ne: null } } },
      expect.objectContaining({ $lookup: expect.objectContaining({ from: 'listings' }) }),
      { $match: { 'listing.asin': { $in: ['B0ASIN'] } } },
    ]));
  });
});
