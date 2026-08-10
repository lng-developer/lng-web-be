const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const logger = require('../../../src/shared/utils/logger');
const AdsSpendDaily = require('../../../src/modules/finance/models/adsSpendDaily.model');
const FinanceSnapshot = require('../../../src/modules/finance/models/financeSnapshot.model');
const Order = require('../../../src/modules/order/models/order.model');
const OrderItem = require('../../../src/modules/order/models/orderItem.model');
const { upsertDemoShops } = require('./seedShopDemo');

const DEMO_DAYS = 90;
const ORDERS_PER_DAY_CHANNEL = 4;
const BUYER_POOL_SIZE = 120;
const ORDER_PREFIX = 'DASH-DEMO-';
const ITEM_PREFIX = 'DASH-DEMO-ITEM-';
const ANALYTICS_SOURCE_REF = 'analytics-demo-seed';
const DEFAULT_SEED_ANCHOR = new Date('2026-07-20T12:00:00.000Z');
const CAMPAIGN_TYPES = ['BRANDED', 'PROSPECTING'];
const DEMO_CHANNELS = Object.freeze([
  { salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', shopId: '660000000000000000000201' },
  { salesChannelCode: 'ETSY', marketplaceCode: 'ETSY_US', shopId: '660000000000000000000202' },
]);

function assertAnalyticsDemoSeedAllowed(env = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Analytics demo seed is disabled in production');
  }
  if (env.ALLOW_ANALYTICS_DEMO_SEED !== 'true') {
    throw new Error('Set ALLOW_ANALYTICS_DEMO_SEED=true to run the analytics demo seed');
  }
}

function seededHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function dayAtOffset(now, offset) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  date.setUTCDate(date.getUTCDate() - DEMO_DAYS + 1 + offset);
  return date;
}

function demoOrderStatus(seed) {
  return ['PROCESSING', 'PROCESSING', 'SHIPPED', 'PROCESSING', 'CANCELLED'][seed % 5];
}

function demoItemStatus(seed) {
  return [
    'MAPPING_PENDING',
    'NEED_PRODUCTION',
    'SENT_TO_VENDOR',
    'SHIPPED',
    'TRACKING_PENDING',
  ][seed % 5];
}

function buildAnalyticsRows(now = DEFAULT_SEED_ANCHOR) {
  return Array.from({ length: DEMO_DAYS }, (_, dayIndex) => (
    DEMO_CHANNELS.flatMap((channel, channelIndex) => (
      Array.from({ length: ORDERS_PER_DAY_CHANNEL }, (_, orderIndex) => {
        const seed = seededHash(`${dayIndex}:${channelIndex}:${orderIndex}`);
        const orderedAt = dayAtOffset(now, dayIndex);
        const dayKey = isoDay(orderedAt).replaceAll('-', '');
        const externalOrderId = `${ORDER_PREFIX}${channel.salesChannelCode}-${dayKey}-${String(orderIndex + 1).padStart(2, '0')}`;
        const externalItemId = `${ITEM_PREFIX}${channel.salesChannelCode}-${dayKey}-${String(orderIndex + 1).padStart(2, '0')}`;
        const itemPriceAmount = 2695 + ((seed % 6) * 350);
        const shippingAmount = 495;
        const buyerIndex = (dayIndex * 8 + channelIndex * ORDERS_PER_DAY_CHANNEL + orderIndex) % BUYER_POOL_SIZE;
        const baseCostAmount = 1050 + ((seed % 7) * 120);
        const totalCostAmount = baseCostAmount + 280;
        const feeAmount = Math.round((itemPriceAmount + shippingAmount) * 0.14);
        const refundAmount = seed % 17 === 0 ? 250 : 0;
        const grossProfitAmount = itemPriceAmount + shippingAmount - totalCostAmount - feeAmount - refundAmount;

        return {
          externalOrderId,
          order: {
            shopId: channel.shopId,
            salesChannelCode: channel.salesChannelCode,
            marketplaceCode: channel.marketplaceCode,
            externalOrderId,
            externalStatus: demoOrderStatus(seed),
            costCenterStatus: seed % 11 === 0 ? 'MISSING' : 'PRESENT',
            psdStatus: seed % 13 === 0 ? 'MISSING' : 'PRESENT',
            paymentStatus: 'PAID',
            caseStatus: 'NONE',
            orderedAt,
            shipByDate: new Date(orderedAt.getTime() + (5 * 86400000)),
            buyer: {
              name: `Demo buyer ${buyerIndex + 1}`,
              emailMasked: `demo-${buyerIndex + 1}@example.com`,
              externalBuyerId: `DASH-BUYER-${String(buyerIndex + 1).padStart(3, '0')}`,
            },
            addressValidationStatus: 'VALID',
            status: demoOrderStatus(seed),
            importSources: ['MANUAL_EXCEL'],
            importedAt: orderedAt,
            lastImportedAt: orderedAt,
            createdAt: orderedAt,
            updatedAt: orderedAt,
          },
          item: {
            externalItemId,
            externalOrderId,
            externalProductId: `DASH-PRODUCT-${seed % 18}`,
            externalListingId: `DASH-LISTING-${seed % 24}`,
            sku: `DASH-${channel.salesChannelCode}-${String((seed % 24) + 1).padStart(3, '0')}`,
            title: `${channel.salesChannelCode === 'ETSY' ? 'Etsy' : 'Amazon'} demo personalized product ${seed % 24}`,
            quantity: 1 + (seed % 2),
            price: {
              itemPriceAmount,
              shippingPriceAmount: shippingAmount,
              itemTaxAmount: 0,
              shippingTaxAmount: 0,
              giftWrapPriceAmount: 0,
              giftWrapTaxAmount: 0,
              itemPromotionDiscountAmount: seed % 9 === 0 ? 150 : 0,
              shipPromotionDiscountAmount: 0,
              currency: 'USD',
            },
            status: demoItemStatus(seed),
            shipByDate: new Date(orderedAt.getTime() + (5 * 86400000)),
            importSources: ['MANUAL_EXCEL'],
            importedAt: orderedAt,
            lastImportedAt: orderedAt,
            createdAt: orderedAt,
            updatedAt: orderedAt,
          },
          snapshot: {
            itemPriceAmount,
            shippingAmount,
            customerPaidAmount: itemPriceAmount + shippingAmount,
            feeAmount,
            baseCostAmount,
            totalCostAmount,
            refundAmount,
            grossProfitAmount,
            grossMarginBps: Math.round((grossProfitAmount / (itemPriceAmount + shippingAmount)) * 10000),
            calculatedAt: orderedAt,
            createdAt: orderedAt,
            updatedAt: orderedAt,
          },
        };
      })
    ))
  )).flat();
}

function buildAnalyticsAds(rows) {
  const dailyChannels = new Map();
  rows.forEach(({ order }) => {
    const dayKey = isoDay(order.orderedAt);
    const key = `${order.shopId}:${order.salesChannelCode}:${dayKey}`;
    if (!dailyChannels.has(key)) dailyChannels.set(key, { ...order, dayKey });
  });

  return [...dailyChannels.values()].flatMap((order) => CAMPAIGN_TYPES.map((campaignType) => {
    const seed = seededHash(`${order.salesChannelCode}:${order.dayKey}:${campaignType}`);
    const clicks = 18 + (seed % 37);
    const impressions = clicks * (24 + (seed % 17));
    const spendAmount = 220 + ((seed % 10) * 40);
    const attributedSalesAmount = Math.max(spendAmount * 3, 3190 + ((seed % 6) * 350));
    const reportDate = new Date(order.orderedAt);

    return {
      shopId: order.shopId,
      salesChannelCode: order.salesChannelCode,
      marketplaceCode: order.marketplaceCode,
      reportDate,
      portfolioName: `${order.salesChannelCode} demo ${campaignType}`,
      programType: 'SPONSORED_PRODUCTS',
      campaignName: `DASH-DEMO-${order.salesChannelCode}-${order.dayKey}-${campaignType}`,
      retailer: order.salesChannelCode,
      country: 'US',
      status: 'ENABLED',
      currency: 'USD',
      budgetAmount: spendAmount * 4,
      spendAmount,
      attributedSalesAmount,
      impressions,
      clicks,
      orders7d: 1 + (seed % 3),
      ctrBps: Math.round((clicks / impressions) * 10000),
      acosBps: Math.round((spendAmount / attributedSalesAmount) * 10000),
      roasBps: Math.round((attributedSalesAmount / spendAmount) * 10000),
      cpcAmount: Math.round(spendAmount / clicks),
      sourceType: 'SYSTEM',
      sourceRef: ANALYTICS_SOURCE_REF,
      createdAt: reportDate,
      updatedAt: reportDate,
    };
  }));
}

async function resetAnalyticsDemo({
  AdsSpendDaily: AdsSpendDailyModel = AdsSpendDaily,
  FinanceSnapshot: FinanceSnapshotModel = FinanceSnapshot,
  Order: OrderModel = Order,
  OrderItem: OrderItemModel = OrderItem,
} = {}) {
  const demoOrderFilter = { externalOrderId: { $regex: `^${ORDER_PREFIX}` } };
  const demoAdsFilter = { sourceRef: ANALYTICS_SOURCE_REF };
  const demoOrders = await OrderModel.find(demoOrderFilter).select('_id').lean();
  const orderIds = demoOrders.map((order) => order._id);
  const demoItems = orderIds.length
    ? await OrderItemModel.find({ orderId: { $in: orderIds } }).select('_id').lean()
    : [];
  const itemIds = demoItems.map((item) => item._id);
  const [snapshots, ads, items, orders] = await Promise.all([
    itemIds.length ? FinanceSnapshotModel.deleteMany({ orderItemId: { $in: itemIds } }) : { deletedCount: 0 },
    AdsSpendDailyModel.deleteMany(demoAdsFilter),
    orderIds.length ? OrderItemModel.deleteMany({ orderId: { $in: orderIds } }) : { deletedCount: 0 },
    orderIds.length ? OrderModel.deleteMany({ _id: { $in: orderIds } }) : { deletedCount: 0 },
  ]);
  return {
    deletedAds: ads.deletedCount || 0,
    deletedOrders: orders.deletedCount || 0,
    deletedOrderItems: items.deletedCount || 0,
    deletedSnapshots: snapshots.deletedCount || 0,
  };
}

async function seedAnalyticsDemo({ reset = false, env = process.env, dependencies = {} } = {}) {
  const connect = dependencies.connectDatabase || connectDatabase;
  const disconnect = dependencies.disconnectDatabase || disconnectDatabase;
  const seedShops = dependencies.upsertDemoShops || upsertDemoShops;
  const AdsSpendDailyModel = dependencies.AdsSpendDaily || AdsSpendDaily;
  const FinanceSnapshotModel = dependencies.FinanceSnapshot || FinanceSnapshot;
  const OrderModel = dependencies.Order || Order;
  const OrderItemModel = dependencies.OrderItem || OrderItem;
  assertAnalyticsDemoSeedAllowed(env);
  await connect();
  try {
    await seedShops();
    const resetResult = reset ? await resetAnalyticsDemo(dependencies) : null;
    const rows = buildAnalyticsRows();
    const ads = buildAnalyticsAds(rows);
    await OrderModel.bulkWrite(rows.map(({ order }) => ({
      updateOne: {
        filter: {
          shopId: order.shopId,
          salesChannelCode: order.salesChannelCode,
          externalOrderId: order.externalOrderId,
        },
        update: { $setOnInsert: order },
        upsert: true,
      },
    })), { ordered: false, timestamps: false });

    const externalOrderIds = rows.map((row) => row.externalOrderId);
    const orders = await OrderModel.find({ externalOrderId: { $in: externalOrderIds } })
      .select('_id externalOrderId shopId salesChannelCode marketplaceCode')
      .lean();
    const orderByExternalId = new Map(orders.map((order) => [order.externalOrderId, order]));
    const resolvedRows = rows.map((row) => ({ ...row, resolvedOrder: orderByExternalId.get(row.externalOrderId) }));

    await OrderItemModel.bulkWrite(resolvedRows.map(({ item, resolvedOrder }) => ({
      updateOne: {
        filter: { orderId: resolvedOrder._id, externalItemId: item.externalItemId },
        update: {
          $setOnInsert: {
            ...item,
            orderId: resolvedOrder._id,
            shopId: resolvedOrder.shopId,
            salesChannelCode: resolvedOrder.salesChannelCode,
            marketplaceCode: resolvedOrder.marketplaceCode,
            externalOrderId: resolvedOrder.externalOrderId,
          },
        },
        upsert: true,
      },
    })), { ordered: false, timestamps: false });

    const items = await OrderItemModel.find({ externalOrderId: { $in: externalOrderIds } })
      .select('_id orderId externalOrderId shopId salesChannelCode marketplaceCode')
      .lean();
    const itemByOrderId = new Map(items.map((item) => [String(item.orderId), item]));
    const snapshots = resolvedRows.map(({ snapshot, resolvedOrder }) => {
      const item = itemByOrderId.get(String(resolvedOrder._id));
      return {
        ...snapshot,
        orderId: resolvedOrder._id,
        orderItemId: item._id,
        shopId: resolvedOrder.shopId,
        salesChannelCode: resolvedOrder.salesChannelCode,
        marketplaceCode: resolvedOrder.marketplaceCode,
        currency: 'USD',
        costLines: [
          { code: 'BASE_COST', label: 'Demo base cost', amount: snapshot.baseCostAmount },
          { code: 'FULFILLMENT', label: 'Demo fulfillment cost', amount: 280 },
        ],
        costStatus: 'PRESENT',
        snapshotStatus: 'ESTIMATED',
      };
    });
    await FinanceSnapshotModel.bulkWrite(snapshots.map((snapshot) => ({
      updateOne: {
        filter: { orderItemId: snapshot.orderItemId },
        update: { $setOnInsert: snapshot },
        upsert: true,
      },
    })), { ordered: false, timestamps: false });

    await AdsSpendDailyModel.bulkWrite(ads.map((ad) => ({
      updateOne: {
        filter: {
          shopId: ad.shopId,
          salesChannelCode: ad.salesChannelCode,
          marketplaceCode: ad.marketplaceCode,
          reportDate: ad.reportDate,
          campaignName: ad.campaignName,
        },
        update: { $setOnInsert: ad },
        upsert: true,
      },
    })), { ordered: false, timestamps: false });

    const result = {
      orderCount: rows.length,
      orderItemCount: items.length,
      snapshotCount: snapshots.length,
      adsCount: ads.length,
      ...(resetResult ? { reset: resetResult } : {}),
    };
    logger.info('analytics_demo_seed_completed', result);
    return result;
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  seedAnalyticsDemo({ reset }).catch((error) => {
    logger.error('analytics_demo_seed_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  ANALYTICS_SOURCE_REF,
  assertAnalyticsDemoSeedAllowed,
  BUYER_POOL_SIZE,
  DEMO_DAYS,
  ITEM_PREFIX,
  ORDER_PREFIX,
  ORDERS_PER_DAY_CHANNEL,
  buildAnalyticsAds,
  buildAnalyticsRows,
  buildDemoRows: buildAnalyticsRows,
  resetAnalyticsDemo,
  seedAnalyticsDemo,
};
