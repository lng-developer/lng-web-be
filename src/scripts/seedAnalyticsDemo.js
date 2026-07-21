const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../shared/utils/logger');
const AdsSpendDaily = require('../modules/finance/models/adsSpendDaily.model');
const FinanceSnapshot = require('../modules/finance/models/financeSnapshot.model');
const Order = require('../modules/order/models/order.model');
const OrderItem = require('../modules/order/models/orderItem.model');
const { upsertDemoShops } = require('./seedShopDemo');

const DEMO_DAYS = 90;
const ORDERS_PER_DAY_CHANNEL = 4;
const ORDER_PREFIX = 'DASH-DEMO-';
const ITEM_PREFIX = 'DASH-DEMO-ITEM-';
const ANALYTICS_SOURCE_REF = 'analytics-demo-seed';
const DEMO_CHANNELS = Object.freeze([
  { salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', shopId: '660000000000000000000201' },
  { salesChannelCode: 'ETSY', marketplaceCode: 'ETSY_US', shopId: '660000000000000000000202' },
]);

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
    'CUSTOMIZATION_PENDING',
    'NEED_PRODUCTION',
    'IN_PRODUCTION',
    'READY_TO_SEND_VENDOR',
    'SENT_TO_VENDOR',
    'TRACKING_PENDING',
    'SHIPPED',
  ][seed % 8];
}

function buildDemoRows(now = new Date()) {
  return Array.from({ length: DEMO_DAYS }, (_, dayIndex) => (
    DEMO_CHANNELS.flatMap((channel, channelIndex) => (
      Array.from({ length: ORDERS_PER_DAY_CHANNEL }, (_, orderIndex) => {
        const seed = (dayIndex * 13) + (channelIndex * 7) + orderIndex;
        const orderedAt = dayAtOffset(now, dayIndex);
        const dayKey = isoDay(orderedAt).replaceAll('-', '');
        const externalOrderId = `${ORDER_PREFIX}${channel.salesChannelCode}-${dayKey}-${String(orderIndex + 1).padStart(2, '0')}`;
        const externalItemId = `${ITEM_PREFIX}${channel.salesChannelCode}-${dayKey}-${String(orderIndex + 1).padStart(2, '0')}`;
        const itemPriceAmount = 2695 + ((seed % 6) * 350);
        const shippingAmount = 495;
        const buyerIndex = (dayIndex * 3 + orderIndex + channelIndex * 19) % 140;
        const itemStatus = demoItemStatus(seed);
        const baseCostAmount = 1050 + ((seed % 7) * 120);
        const feeAmount = Math.round((itemPriceAmount + shippingAmount) * 0.14);
        const grossProfitAmount = itemPriceAmount + shippingAmount - baseCostAmount - feeAmount;
        const clicks = 18 + (seed % 37);
        const spendAmount = 220 + ((seed % 10) * 40);
        const attributedSalesAmount = Math.max(spendAmount * 3, itemPriceAmount + shippingAmount);

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
              externalBuyerId: `DASH-BUYER-${channel.salesChannelCode}-${buyerIndex + 1}`,
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
            status: itemStatus,
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
            totalCostAmount: baseCostAmount + 280,
            grossProfitAmount,
            grossMarginBps: Math.round((grossProfitAmount / (itemPriceAmount + shippingAmount)) * 10000),
            calculatedAt: orderedAt,
          },
          ad: {
            reportDate: orderedAt,
            portfolioName: `${channel.salesChannelCode} demo acquisition`,
            programType: 'SPONSORED_PRODUCTS',
            campaignName: `${externalOrderId}-ACQ`,
            retailer: channel.salesChannelCode,
            country: 'US',
            status: 'ENABLED',
            currency: 'USD',
            budgetAmount: spendAmount * 4,
            spendAmount,
            attributedSalesAmount,
            impressions: clicks * (24 + (seed % 17)),
            clicks,
            orders7d: 1 + (seed % 2),
            ctrBps: Math.round((clicks / (clicks * (24 + (seed % 17)))) * 10000),
            acosBps: Math.round((spendAmount / attributedSalesAmount) * 10000),
            roasBps: Math.round((attributedSalesAmount / spendAmount) * 10000),
            cpcAmount: Math.round(spendAmount / clicks),
            sourceType: 'SYSTEM',
            sourceRef: ANALYTICS_SOURCE_REF,
          },
        };
      })
    ))
  )).flat();
}

async function resetAnalyticsDemo() {
  const demoOrders = await Order.find({ externalOrderId: { $regex: `^${ORDER_PREFIX}` } }).select('_id').lean();
  const orderIds = demoOrders.map((order) => order._id);
  const demoItems = orderIds.length
    ? await OrderItem.find({ orderId: { $in: orderIds } }).select('_id').lean()
    : [];
  const itemIds = demoItems.map((item) => item._id);
  const [snapshots, ads, items, orders] = await Promise.all([
    itemIds.length ? FinanceSnapshot.deleteMany({ orderItemId: { $in: itemIds } }) : { deletedCount: 0 },
    AdsSpendDaily.deleteMany({ sourceRef: ANALYTICS_SOURCE_REF }),
    orderIds.length ? OrderItem.deleteMany({ orderId: { $in: orderIds } }) : { deletedCount: 0 },
    orderIds.length ? Order.deleteMany({ _id: { $in: orderIds } }) : { deletedCount: 0 },
  ]);
  return {
    deletedAds: ads.deletedCount || 0,
    deletedOrders: orders.deletedCount || 0,
    deletedOrderItems: items.deletedCount || 0,
    deletedSnapshots: snapshots.deletedCount || 0,
  };
}

async function seedAnalyticsDemo({ replace = false } = {}) {
  await connectDatabase();
  try {
    await upsertDemoShops();
    if (replace) await resetAnalyticsDemo();
    const rows = buildDemoRows();
    await Order.bulkWrite(rows.map(({ order }) => ({
      updateOne: {
        filter: {
          salesChannelCode: order.salesChannelCode,
          marketplaceCode: order.marketplaceCode,
          externalOrderId: order.externalOrderId,
        },
        update: { $setOnInsert: order },
        upsert: true,
      },
    })), { ordered: false, timestamps: false });

    const externalOrderIds = rows.map((row) => row.externalOrderId);
    const orders = await Order.find({ externalOrderId: { $in: externalOrderIds } })
      .select('_id externalOrderId shopId salesChannelCode marketplaceCode')
      .lean();
    const orderByExternalId = new Map(orders.map((order) => [order.externalOrderId, order]));
    const resolvedRows = rows.map((row) => ({ ...row, resolvedOrder: orderByExternalId.get(row.externalOrderId) }));

    await OrderItem.bulkWrite(resolvedRows.map(({ item, resolvedOrder }) => ({
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

    const items = await OrderItem.find({ externalOrderId: { $in: externalOrderIds } })
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
    await FinanceSnapshot.bulkWrite(snapshots.map((snapshot) => ({
      updateOne: {
        filter: { orderItemId: snapshot.orderItemId },
        update: { $setOnInsert: snapshot },
        upsert: true,
      },
    })), { ordered: false, timestamps: false });

    await AdsSpendDaily.bulkWrite(resolvedRows.map(({ ad, resolvedOrder }) => ({
      updateOne: {
        filter: {
          shopId: resolvedOrder.shopId,
          salesChannelCode: resolvedOrder.salesChannelCode,
          marketplaceCode: resolvedOrder.marketplaceCode,
          reportDate: ad.reportDate,
          campaignName: ad.campaignName,
        },
        update: {
          $setOnInsert: {
            ...ad,
            shopId: resolvedOrder.shopId,
            salesChannelCode: resolvedOrder.salesChannelCode,
            marketplaceCode: resolvedOrder.marketplaceCode,
          },
        },
        upsert: true,
      },
    })), { ordered: false, timestamps: false });

    const result = { orderCount: rows.length, orderItemCount: items.length, snapshotCount: snapshots.length, adsCount: rows.length };
    logger.info('analytics_demo_seed_completed', result);
    return result;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  const resetOnly = process.argv.includes('--reset');
  const replace = process.argv.includes('--replace');
  const run = resetOnly ? (async () => {
    await connectDatabase();
    try {
      const result = await resetAnalyticsDemo();
      logger.info('analytics_demo_reset_completed', result);
    } finally {
      await disconnectDatabase();
    }
  }) : () => seedAnalyticsDemo({ replace });
  run().catch((error) => {
    logger.error('analytics_demo_seed_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  ANALYTICS_SOURCE_REF,
  DEMO_DAYS,
  ITEM_PREFIX,
  ORDER_PREFIX,
  ORDERS_PER_DAY_CHANNEL,
  buildDemoRows,
  resetAnalyticsDemo,
  seedAnalyticsDemo,
};
