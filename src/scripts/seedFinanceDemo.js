const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../shared/utils/logger');
const AdsSpendDaily = require('../modules/finance/models/adsSpendDaily.model');
const FinanceSnapshot = require('../modules/finance/models/financeSnapshot.model');
const OrderItem = require('../modules/order/models/orderItem.model');

const REPORT_DAYS = 28;

function hash(value) {
  return [...String(value)].reduce((result, character) => (
    ((result * 31) + character.charCodeAt(0)) >>> 0
  ), 7);
}

function amount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function sellerCode(sku) {
  return String(sku || '').trim().split('-')[0]?.toUpperCase() || 'UNASSIGNED';
}

function reportDate(seed, now) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  date.setUTCDate(date.getUTCDate() - REPORT_DAYS + 1 + (seed % REPORT_DAYS));
  return date;
}

function buildDemoSnapshot(item, now = new Date()) {
  const seed = hash(item._id);
  const price = item.price || {};
  const sourceItemPrice = amount(price.itemPriceAmount);
  const sourceShipping = amount(price.shippingPriceAmount);
  const sourceRevenue = sourceItemPrice + sourceShipping;
  const shippingAmount = sourceRevenue > 0 ? sourceShipping : 495;
  const customerPaidAmount = sourceRevenue > 0 ? sourceRevenue : 2995 + ((seed % 7) * 500);
  const itemPriceAmount = sourceItemPrice || customerPaidAmount - shippingAmount;
  const discountAmount = amount(price.itemPromotionDiscountAmount) + amount(price.shipPromotionDiscountAmount) || (seed % 6 === 0 ? 200 : 0);
  const feeAmount = Math.round(customerPaidAmount * (12 + (seed % 5)) / 100);
  const refundAmount = seed % 17 === 0 ? Math.round(customerPaidAmount * 0.2) : 0;
  const baseCostAmount = 1050 + ((seed % 8) * 125);
  const totalCostAmount = baseCostAmount + 250 + ((seed % 4) * 75);
  const grossProfitAmount = customerPaidAmount - feeAmount - refundAmount - baseCostAmount - discountAmount;
  const code = sellerCode(item.sku);
  const channel = item.salesChannelCode || 'AMAZON';

  return {
    orderId: item.orderId,
    orderItemId: item._id,
    shopId: item.shopId,
    salesChannelCode: channel,
    marketplaceCode: item.marketplaceCode || `${channel}_US`,
    fulfillmentPlanId: null,
    vendorProductId: null,
    vendorCostCenterId: null,
    shipmentId: null,
    sellerEmployeeCode: code,
    sellerAccountId: null,
    sellerName: `Seller ${code}`,
    teamId: null,
    teamName: `${channel === 'ETSY' ? 'Etsy' : 'Amazon'} Operations`,
    teamCode: channel,
    departmentId: null,
    departmentName: 'Revenue Operations',
    departmentCode: 'REVENUE',
    itemPriceAmount,
    taxAmount: amount(price.itemTaxAmount) + amount(price.shippingTaxAmount) + amount(price.giftWrapTaxAmount),
    shippingAmount,
    giftWrapAmount: amount(price.giftWrapPriceAmount),
    discountAmount,
    feeAmount,
    refundAmount,
    customerPaidAmount,
    currency: price.currency || 'USD',
    baseCostAmount,
    totalCostAmount,
    costLines: [
      { code: 'BASE_COST', label: 'Demo base cost', amount: baseCostAmount },
      { code: 'FULFILLMENT', label: 'Demo fulfillment cost', amount: totalCostAmount - baseCostAmount },
    ],
    costStatus: 'PRESENT',
    grossProfitAmount,
    grossMarginBps: Math.round((grossProfitAmount / customerPaidAmount) * 10000),
    snapshotStatus: 'ESTIMATED',
    calculatedAt: reportDate(seed, now),
  };
}

function buildDemoAdSpend(item, snapshot) {
  const seed = hash(item._id);
  const clicks = 12 + (seed % 28);
  const impressions = clicks * (18 + (seed % 22));
  const spendAmount = 180 + ((seed % 9) * 45);
  const attributedSalesAmount = Math.max(spendAmount * 3, Math.round(snapshot.customerPaidAmount * 0.72));

  return {
    shopId: item.shopId,
    salesChannelCode: snapshot.salesChannelCode,
    marketplaceCode: snapshot.marketplaceCode,
    reportDate: snapshot.calculatedAt,
    portfolioName: 'Demo portfolio',
    programType: 'SPONSORED_PRODUCTS',
    campaignName: `DEMO-${item._id}`,
    retailer: snapshot.salesChannelCode,
    country: 'US',
    status: 'ENABLED',
    currency: snapshot.currency,
    budgetAmount: spendAmount * 4,
    spendAmount,
    attributedSalesAmount,
    impressions,
    clicks,
    orders7d: Math.max(1, Math.round(attributedSalesAmount / snapshot.customerPaidAmount)),
    ctrBps: Math.round((clicks / impressions) * 10000),
    acosBps: Math.round((spendAmount / attributedSalesAmount) * 10000),
    roasBps: Math.round((attributedSalesAmount / spendAmount) * 10000),
    cpcAmount: Math.round(spendAmount / clicks),
    sourceType: 'MANUAL',
    sourceRef: 'finance-demo-seed',
    rawReference: { importKey: `finance-demo-ad-${item._id}` },
  };
}

async function seedFinanceDemo({ replace = false } = {}) {
  await connectDatabase();

  try {
    const items = await OrderItem.find().select('_id orderId shopId salesChannelCode marketplaceCode sku price').lean();
    const now = new Date();
    const itemIds = items.map((item) => item._id);
    const existingSnapshots = itemIds.length
      ? await FinanceSnapshot.find({ orderItemId: { $in: itemIds } })
        .select('orderItemId salesChannelCode marketplaceCode currency customerPaidAmount calculatedAt')
        .lean()
      : [];
    const existingByOrderItemId = new Map(
      existingSnapshots.map((snapshot) => [String(snapshot.orderItemId), snapshot]),
    );
    const snapshots = items.map((item) => (
      existingByOrderItemId.get(String(item._id)) || buildDemoSnapshot(item, now)
    ));
    const operations = items.map((item, index) => ({
      updateOne: {
        filter: { orderItemId: item._id },
        update: replace ? { $set: snapshots[index] } : { $setOnInsert: snapshots[index] },
        upsert: true,
      },
    }));
    const adOperations = items.map((item, index) => {
      const adSpend = buildDemoAdSpend(item, snapshots[index]);
      return {
        updateOne: {
          filter: {
            shopId: item.shopId,
            salesChannelCode: adSpend.salesChannelCode,
            marketplaceCode: adSpend.marketplaceCode,
            reportDate: adSpend.reportDate,
            campaignName: adSpend.campaignName,
          },
          update: replace ? { $set: adSpend } : { $setOnInsert: adSpend },
          upsert: true,
        },
      };
    });
    const result = operations.length ? await FinanceSnapshot.bulkWrite(operations, {
      ordered: false,
      timestamps: false,
    }) : null;
    const adsResult = adOperations.length ? await AdsSpendDaily.bulkWrite(adOperations, {
      ordered: false,
      timestamps: false,
    }) : null;
    const created = result?.upsertedCount || 0;
    const updated = result?.modifiedCount || 0;
    const adsCreated = adsResult?.upsertedCount || 0;
    const adsUpdated = adsResult?.modifiedCount || 0;

    logger.info('finance_demo_seed_completed', {
      adsCreated,
      adsUpdated,
      created,
      itemCount: items.length,
      replace,
      updated,
    });
    return { adsCreated, adsUpdated, created, itemCount: items.length, updated };
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  seedFinanceDemo({ replace: process.argv.includes('--replace') }).catch((error) => {
    logger.error('finance_demo_seed_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  buildDemoAdSpend,
  buildDemoSnapshot,
  seedFinanceDemo,
};
