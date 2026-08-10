jest.mock('../../../../src/modules/finance/models/adsSpendDaily.model', () => ({}));
jest.mock('../../../../src/modules/finance/models/financeSnapshot.model', () => ({}));
jest.mock('../../../../src/modules/order/models/order.model', () => ({}));
jest.mock('../../../../src/modules/order/models/orderItem.model', () => ({}));
jest.mock('../../../../tools/scripts/seed/seedShopDemo', () => ({
  upsertDemoShops: jest.fn().mockRejectedValue(new Error('default shop seed dependency used')),
}));

const {
  ANALYTICS_SOURCE_REF,
  assertAnalyticsDemoSeedAllowed,
  buildAnalyticsAds,
  buildAnalyticsRows,
  DEMO_DAYS,
  ORDERS_PER_DAY_CHANNEL,
  resetAnalyticsDemo,
  seedAnalyticsDemo,
} = require('../../../../tools/scripts/seed/seedAnalyticsDemo');
const { orderItemStatuses } = require('../../../../src/modules/order/constants/orderStatuses');

const DEMO_NOW = new Date('2026-07-20T12:00:00.000Z');

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function moneyValues(row) {
  return [
    ...Object.values(row.item.price).filter((value) => typeof value === 'number'),
    ...Object.values(row.snapshot).filter((value) => typeof value === 'number'),
  ];
}

function queryResult(rows) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(rows),
    }),
  };
}

describe('commercial analytics demo builders', () => {
  it('refuses production and requires an explicit seed opt-in without exposing env values', () => {
    const productionEnv = {
      NODE_ENV: 'production',
      ALLOW_ANALYTICS_DEMO_SEED: 'secret-production-value',
    };
    const missingOptInEnv = {
      NODE_ENV: 'development',
      ALLOW_ANALYTICS_DEMO_SEED: 'secret-development-value',
    };

    expect(() => assertAnalyticsDemoSeedAllowed(productionEnv)).toThrow('disabled in production');
    expect(() => assertAnalyticsDemoSeedAllowed(missingOptInEnv)).toThrow('ALLOW_ANALYTICS_DEMO_SEED=true');
    expect(() => assertAnalyticsDemoSeedAllowed(productionEnv)).not.toThrow('secret-production-value');
    expect(() => assertAnalyticsDemoSeedAllowed(missingOptInEnv)).not.toThrow('secret-development-value');
    expect(() => assertAnalyticsDemoSeedAllowed({
      NODE_ENV: 'development',
      ALLOW_ANALYTICS_DEMO_SEED: 'true',
    })).not.toThrow();
  });

  it('checks the opt-in before connecting to the database', async () => {
    const connectDatabase = jest.fn();

    await expect(seedAnalyticsDemo({
      env: { NODE_ENV: 'test' },
      dependencies: { connectDatabase },
    })).rejects.toThrow('ALLOW_ANALYTICS_DEMO_SEED=true');
    expect(connectDatabase).not.toHaveBeenCalled();
  });

  it('resets only marked demo records through resolved order and item IDs', async () => {
    const dependencies = {
      Order: {
        find: jest.fn().mockReturnValue(queryResult([{ _id: 'demo-order-id' }])),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      },
      OrderItem: {
        find: jest.fn().mockReturnValue(queryResult([{ _id: 'demo-item-id' }])),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      },
      FinanceSnapshot: {
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      },
      AdsSpendDaily: {
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      },
    };

    await expect(resetAnalyticsDemo(dependencies)).resolves.toEqual({
      deletedAds: 1,
      deletedOrders: 1,
      deletedOrderItems: 1,
      deletedSnapshots: 1,
    });
    expect(dependencies.Order.find).toHaveBeenCalledWith({
      externalOrderId: { $regex: '^DASH-DEMO-' },
    });
    expect(dependencies.AdsSpendDaily.deleteMany).toHaveBeenCalledWith({
      sourceRef: 'analytics-demo-seed',
    });
    expect(dependencies.OrderItem.find).toHaveBeenCalledWith({
      orderId: { $in: ['demo-order-id'] },
    });
    expect(dependencies.FinanceSnapshot.deleteMany).toHaveBeenCalledWith({
      orderItemId: { $in: ['demo-item-id'] },
    });
    expect(dependencies.OrderItem.deleteMany).toHaveBeenCalledWith({
      orderId: { $in: ['demo-order-id'] },
    });
    expect(dependencies.Order.deleteMany).toHaveBeenCalledWith({
      _id: { $in: ['demo-order-id'] },
    });
  });

  it('upserts orders by shop, channel, and external order ID using injected persistence', async () => {
    const rows = buildAnalyticsRows(DEMO_NOW);
    const orders = rows.map(({ order }, index) => ({
      _id: `order-${index}`,
      externalOrderId: order.externalOrderId,
      shopId: order.shopId,
      salesChannelCode: order.salesChannelCode,
      marketplaceCode: order.marketplaceCode,
    }));
    const items = orders.map((order, index) => ({
      _id: `item-${index}`,
      orderId: order._id,
      externalOrderId: order.externalOrderId,
      shopId: order.shopId,
      salesChannelCode: order.salesChannelCode,
      marketplaceCode: order.marketplaceCode,
    }));
    const dependencies = {
      connectDatabase: jest.fn(),
      disconnectDatabase: jest.fn(),
      upsertDemoShops: jest.fn(),
      Order: {
        bulkWrite: jest.fn().mockResolvedValue({}),
        find: jest.fn().mockReturnValue(queryResult(orders)),
      },
      OrderItem: {
        bulkWrite: jest.fn().mockResolvedValue({}),
        find: jest.fn().mockReturnValue(queryResult(items)),
      },
      FinanceSnapshot: { bulkWrite: jest.fn().mockResolvedValue({}) },
      AdsSpendDaily: { bulkWrite: jest.fn().mockResolvedValue({}) },
    };

    await expect(seedAnalyticsDemo({
      env: { NODE_ENV: 'test', ALLOW_ANALYTICS_DEMO_SEED: 'true' },
      dependencies,
    })).resolves.toMatchObject({
      orderCount: rows.length,
      orderItemCount: items.length,
    });

    const orderUpserts = dependencies.Order.bulkWrite.mock.calls[0][0];
    orderUpserts.forEach(({ updateOne }, index) => {
      expect(updateOne.filter).toEqual({
        shopId: rows[index].order.shopId,
        salesChannelCode: rows[index].order.salesChannelCode,
        externalOrderId: rows[index].order.externalOrderId,
      });
    });
    expect(dependencies.connectDatabase).toHaveBeenCalledTimes(1);
    expect(dependencies.disconnectDatabase).toHaveBeenCalledTimes(1);
  });

  it('creates 90 UTC days of deterministic Amazon and Etsy orders', () => {
    const rows = buildAnalyticsRows(DEMO_NOW);
    const orderedDays = [...new Set(rows.map((row) => utcDay(row.order.orderedAt)))].sort();

    expect(rows).toHaveLength(DEMO_DAYS * 2 * ORDERS_PER_DAY_CHANNEL);
    expect(orderedDays).toHaveLength(DEMO_DAYS);
    expect(orderedDays[0]).toBe('2026-04-22');
    expect(orderedDays.at(-1)).toBe('2026-07-20');
    expect(rows.every((row) => row.order.externalOrderId.startsWith('DASH-DEMO-'))).toBe(true);
    expect(new Set(rows.map((row) => row.order.salesChannelCode))).toEqual(new Set(['AMAZON', 'ETSY']));
  });

  it('uses one fixed 120-buyer pool repeatedly across the order volume', () => {
    const rows = buildAnalyticsRows(DEMO_NOW);
    const buyerIds = rows.map((row) => row.order.buyer.externalBuyerId);
    const datesByBuyer = new Map();

    rows.forEach((row) => {
      const buyerId = row.order.buyer.externalBuyerId;
      const dates = datesByBuyer.get(buyerId) || new Set();
      dates.add(utcDay(row.order.orderedAt));
      datesByBuyer.set(buyerId, dates);
    });

    expect(buyerIds).toHaveLength(720);
    expect(new Set(buyerIds).size).toBe(120);
    expect([...datesByBuyer.values()].some((dates) => dates.size > 1)).toBe(true);
  });

  it('uses integer minor units and intentionally stays within current operational item statuses', () => {
    const rows = buildAnalyticsRows(DEMO_NOW);
    const itemStatuses = rows.map((row) => row.item.status);

    expect(rows.every((row) => moneyValues(row).every(Number.isInteger))).toBe(true);
    expect(new Set(itemStatuses)).toEqual(new Set([
      'MAPPING_PENDING',
      'NEED_PRODUCTION',
      'SENT_TO_VENDOR',
      'SHIPPED',
      'TRACKING_PENDING',
    ]));
    expect(itemStatuses.filter((status) => status === 'SHIPPED').length).toBeGreaterThan(0);
    expect(itemStatuses).not.toContain('DELIVERED');
    expect(rows.every((row) => Object.values(orderItemStatuses).includes(row.item.status))).toBe(true);
  });

  it('subtracts the snapshot total cost from gross profit in exact integer minor units', () => {
    const rows = buildAnalyticsRows(DEMO_NOW);

    rows.forEach(({ snapshot }) => {
      expect(Number.isInteger(snapshot.grossProfitAmount)).toBe(true);
      expect(snapshot.grossProfitAmount).toBe(
        snapshot.customerPaidAmount
        - snapshot.totalCostAmount
        - snapshot.feeAmount
        - snapshot.refundAmount,
      );
    });
  });

  it('uses the fixed July 20, 2026 seed anchor by default', () => {
    expect(buildAnalyticsRows()).toEqual(buildAnalyticsRows(DEMO_NOW));
  });

  it('creates branded and prospecting ads once per day and channel', () => {
    const rows = buildAnalyticsRows(DEMO_NOW);
    const ads = buildAnalyticsAds(rows);
    const campaignsByDayAndChannel = new Map();

    ads.forEach((ad) => {
      const key = `${utcDay(ad.reportDate)}:${ad.salesChannelCode}`;
      const campaigns = campaignsByDayAndChannel.get(key) || [];
      campaigns.push(ad.campaignName);
      campaignsByDayAndChannel.set(key, campaigns);
    });

    expect(ads).toHaveLength(DEMO_DAYS * 2 * 2);
    expect(ads.every((ad) => ad.sourceRef === ANALYTICS_SOURCE_REF)).toBe(true);
    expect([...campaignsByDayAndChannel.values()].every((campaigns) => (
      campaigns.length === 2
      && campaigns.some((campaign) => campaign.includes('BRANDED'))
      && campaigns.some((campaign) => campaign.includes('PROSPECTING'))
    ))).toBe(true);
    expect(ads.every((ad) => [
      ad.budgetAmount,
      ad.spendAmount,
      ad.attributedSalesAmount,
      ad.cpcAmount,
    ].every(Number.isInteger))).toBe(true);
  });
});
