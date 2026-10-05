const config = require('../../../src/config');
const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const logger = require('../../../src/shared/utils/logger');
const Order = require('../../../src/modules/order/models/order.model');
const OrderItem = require('../../../src/modules/order/models/orderItem.model');
const FinanceSnapshot = require('../../../src/modules/finance/models/financeSnapshot.model');
const AdsSpendDaily = require('../../../src/modules/finance/models/adsSpendDaily.model');
const MarketplaceSettlement = require('../../../src/modules/finance/models/marketplaceSettlement.model');
const MarketplaceSettlementLedgerLine = require('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model');
const { upsertDemoShops } = require('./seedShopDemo');

const DEMO_DATABASE_NAME = 'lng_web_be_demo';
const DEMO_SOURCE_REF = 'demo-finance-report-seed';
const DEMO_DAYS = 90;
const DEMO_SHOP_ID = '660000000000000000000201';
const ORDER_LIFECYCLE_STATUSES = [
  'IMPORTED', 'ON_HOLD', 'PROCESSING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED', 'REFUNDED', 'FAILED',
];
const ITEM_LIFECYCLE_STATUSES = [
  'NEW', 'MAPPING_PENDING', 'CUSTOMIZATION_PENDING', 'CUSTOMIZATION_PARSED', 'FULFILLMENT_PLANNING',
  'FULFILLMENT_READY', 'NEED_PRODUCTION', 'IN_PRODUCTION', 'QC_REJECTED', 'READY_TO_SEND_VENDOR',
  'SENT_TO_VENDOR', 'TRACKING_PENDING', 'SHIPPED', 'CANCELLED', 'REFUNDED', 'FAILED',
];

function seededHash(value) {
  return [...String(value)].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
}

function buildDemoFinanceRows(anchor = new Date('2026-10-05T12:00:00.000Z')) {
  return Array.from({ length: DEMO_DAYS }, (_, index) => {
    const seed = seededHash(index);
    const orderedAt = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - (DEMO_DAYS - 1 - index), 12));
    const day = orderedAt.toISOString().slice(0, 10).replaceAll('-', '');
    const externalOrderId = `DEMO-FIN-AMAZON-${day}-${String(index + 1).padStart(3, '0')}`;
    const externalItemId = `DEMO-FIN-ITEM-${day}-${String(index + 1).padStart(3, '0')}`;
    const customerPaidAmount = 2995 + ((seed % 6) * 350);
    const feeAmount = Math.round(customerPaidAmount * 0.15);
    const missingCost = index % 13 === 0;
    const totalCostAmount = missingCost ? null : 1350 + ((seed % 5) * 120);
    const refundAmount = index % 11 === 0 ? Math.round(customerPaidAmount * 0.75) : 0;
    return {
      order: {
        shopId: DEMO_SHOP_ID, salesChannelCode: 'AMAZON', marketplaceCode: 'US', externalOrderId,
        externalStatus: ORDER_LIFECYCLE_STATUSES[index % ORDER_LIFECYCLE_STATUSES.length],
        status: ORDER_LIFECYCLE_STATUSES[index % ORDER_LIFECYCLE_STATUSES.length],
        costCenterStatus: missingCost ? 'MISSING' : 'PRESENT', psdStatus: index % 7 === 0 ? 'MISSING' : 'PRESENT',
        paymentStatus: refundAmount ? 'REFUNDED' : index % 9 === 0 ? 'PENDING' : 'PAID', caseStatus: index % 10 === 0 ? 'OPEN' : 'NONE',
        orderedAt, shipByDate: new Date(orderedAt.getTime() + 5 * 86400000), addressValidationStatus: index % 17 === 0 ? 'INVALID' : index % 19 === 0 ? 'WARNING' : 'VALID',
        buyer: { name: `Demo buyer ${index + 1}`, emailMasked: `demo-${index + 1}@example.test`, externalBuyerId: `DEMO-FIN-BUYER-${index + 1}` },
        importSources: ['MANUAL_EXCEL'], importedAt: orderedAt, lastImportedAt: orderedAt, createdAt: orderedAt, updatedAt: orderedAt,
      },
      item: {
        externalItemId, externalOrderId, externalProductId: `DEMO-FIN-PRODUCT-${seed % 12}`, externalListingId: `DEMO-FIN-LISTING-${seed % 24}`,
        sku: `J${2500 + (seed % 40)}-DEMO-${String(index + 1).padStart(3, '0')}`, title: 'Synthetic Amazon demo product', quantity: 1,
        status: ITEM_LIFECYCLE_STATUSES[index % ITEM_LIFECYCLE_STATUSES.length], shipByDate: new Date(orderedAt.getTime() + 5 * 86400000),
        price: { itemPriceAmount: customerPaidAmount - 495, shippingPriceAmount: 495, itemTaxAmount: 0, shippingTaxAmount: 0, giftWrapPriceAmount: 0, giftWrapTaxAmount: 0, itemPromotionDiscountAmount: 0, shipPromotionDiscountAmount: 0, currency: 'USD' },
        importSources: ['MANUAL_EXCEL'], importedAt: orderedAt, lastImportedAt: orderedAt, createdAt: orderedAt, updatedAt: orderedAt,
      },
      snapshot: {
        itemPriceAmount: customerPaidAmount - 495, shippingAmount: 495, customerPaidAmount, feeAmount, feeSource: index % 2 ? 'SETTLEMENT' : 'ESTIMATED_15_PERCENT', feeConfidence: index % 2 ? 'ACTUAL' : 'ESTIMATED', refundAmount,
        baseCostAmount: missingCost ? null : totalCostAmount - 250, totalCostAmount, costLines: missingCost ? [] : [{ code: 'BASE_COST', label: 'Demo base cost', amount: totalCostAmount - 250 }, { code: 'FULFILLMENT', label: 'Demo fulfillment cost', amount: 250 }],
        costStatus: missingCost ? 'MISSING' : 'PRESENT', costBasis: missingCost ? 'MISSING' : index % 2 ? 'VENDOR_INVOICE' : 'RATE_CARD', missingCostReason: missingCost ? 'DEMO_MISSING_COST' : null,
        grossProfitAmount: missingCost ? null : customerPaidAmount - feeAmount - refundAmount - totalCostAmount, grossMarginBps: missingCost ? null : Math.round(((customerPaidAmount - feeAmount - refundAmount - totalCostAmount) / customerPaidAmount) * 10000),
        snapshotStatus: missingCost ? 'MISSING_COST' : 'ESTIMATED', profitStatus: missingCost ? 'INCOMPLETE_COST' : index % 2 ? 'ACTUAL' : 'ESTIMATED', calculatedAt: orderedAt, orderedAt,
      },
    };
  });
}

function buildDemoAds(rows = []) {
  return rows.flatMap(({ order, item }, index) => ['BRANDED', 'PROSPECTING'].map((type, campaignIndex) => {
    const seed = seededHash(`${order.externalOrderId}:${type}`);
    const spendAmount = 200 + ((seed % 14) * 55);
    const attributedSalesAmount = campaignIndex === 1 && index % 9 === 0 ? Math.round(spendAmount * 0.7) : spendAmount * (3 + (seed % 4));
    const clicks = 8 + (seed % 45);
    const impressions = clicks * (20 + (seed % 30));
    const sellerEmployeeCode = campaignIndex === 1 && index % 10 === 0 ? null : item.sku.split('-')[0];
    return {
      shopId: order.shopId, salesChannelCode: order.salesChannelCode, marketplaceCode: order.marketplaceCode,
      reportDate: order.orderedAt, portfolioName: sellerEmployeeCode ? `${sellerEmployeeCode} Demo ${type}` : 'Demo Unassigned',
      sellerEmployeeCode, sellerAttributionSource: sellerEmployeeCode ? 'CAMPAIGN_NAME' : 'UNASSIGNED',
      programType: 'SPONSORED_PRODUCTS', campaignName: `DEMO-FIN-${type}-${order.externalOrderId}`, retailer: 'Amazon', country: 'US',
      status: ['ENABLED', 'PAUSED', 'ARCHIVED'][index % 3], currency: 'USD', budgetAmount: spendAmount * 4, spendAmount, attributedSalesAmount,
      impressions, clicks, orders7d: Math.max(0, Math.round(attributedSalesAmount / order.price?.itemPriceAmount || 1)),
      ctrBps: Math.round((clicks / impressions) * 10000), acosBps: Math.round((spendAmount / attributedSalesAmount) * 10000), roasBps: Math.round((attributedSalesAmount / spendAmount) * 10000), cpcAmount: Math.round(spendAmount / clicks),
      sourceType: 'SYSTEM', sourceRef: DEMO_SOURCE_REF, rawReference: { importKey: `demo-ad:${order.externalOrderId}:${type}` },
    };
  }));
}

function buildDemoSettlements(rows = []) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = Math.floor(index / 14);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  });
  return [...groups.entries()].map(([key, group]) => {
    const first = group[0].order.orderedAt;
    const totalAmount = group.reduce((sum, row) => sum + row.snapshot.customerPaidAmount - row.snapshot.feeAmount - row.snapshot.refundAmount, 0);
    return {
      shopId: DEMO_SHOP_ID, salesChannelCode: 'AMAZON', marketplaceCode: 'US', settlementId: `DEMO-FIN-SETTLEMENT-${String(key + 1).padStart(3, '0')}`,
      periodStartAt: first, periodEndAt: group.at(-1).order.orderedAt, depositAt: new Date(group.at(-1).order.orderedAt.getTime() + 3 * 86400000),
      currency: 'USD', totalAmount, grossSalesAmount: group.reduce((sum, row) => sum + row.snapshot.customerPaidAmount, 0), refundAmount: group.reduce((sum, row) => sum + row.snapshot.refundAmount, 0), feeAmount: group.reduce((sum, row) => sum + row.snapshot.feeAmount, 0), advertisingCostAmount: 0, netSettlementAmount: totalAmount, lineCount: group.length * 2,
      sourceType: 'SYSTEM', sourceRef: DEMO_SOURCE_REF, reconciliationStatus: key % 5 === 0 ? 'NEEDS_REVIEW' : key % 3 === 0 ? 'RECONCILED' : 'OPEN', rawReference: { importKey: `demo-settlement:${key}` }, rowIndexes: group.map((row) => rows.indexOf(row)),
    };
  });
}

function buildDemoLedger(rows = [], settlements = []) {
  const ledger = settlements.flatMap((settlement) => settlement.rowIndexes.flatMap((index) => {
    const row = rows[index];
    const base = { shopId: row.order.shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US', settlementId: settlement.settlementId, externalOrderId: row.order.externalOrderId, externalItemId: row.item.externalItemId, sku: row.item.sku, transactionType: 'Order', transactionStatus: 'Released', currency: 'USD', quantityPurchased: row.item.quantity, postedAt: row.order.orderedAt, sourceType: 'SYSTEM', sourceRef: DEMO_SOURCE_REF };
    return [
      { ...base, amountType: 'ItemPrice', amountDescription: 'Principal', amount: row.snapshot.customerPaidAmount, ledgerCategory: 'SETTLEMENT_ACTIVITY', rawReference: { dedupKey: `demo-ledger:${row.item.externalItemId}:principal` } },
      { ...base, amountType: 'ItemFees', amountDescription: 'Commission', amount: -row.snapshot.feeAmount, ledgerCategory: 'SETTLEMENT_ACTIVITY', rawReference: { dedupKey: `demo-ledger:${row.item.externalItemId}:fee` } },
    ];
  }));
  ledger.push({ shopId: DEMO_SHOP_ID, salesChannelCode: 'AMAZON', marketplaceCode: 'US', settlementId: settlements[0]?.settlementId || null, externalOrderId: 'DEMO-UNLINKED-ORDER-001', externalItemId: 'DEMO-UNLINKED-ITEM-001', sku: 'DEMO-UNLINKED', transactionType: 'Adjustment', transactionStatus: 'Released', amountType: 'Other', amountDescription: 'Demo unlinked reconciliation row', amount: -199, ledgerCategory: 'SETTLEMENT_ACTIVITY', currency: 'USD', postedAt: rows[0]?.order.orderedAt || new Date(), sourceType: 'SYSTEM', sourceRef: DEMO_SOURCE_REF, rawReference: { dedupKey: 'demo-ledger:unlinked:001' } });
  return ledger;
}

function databaseNameFromUri(uri) {
  try {
    const pathname = new URL(String(uri || '')).pathname;
    const name = decodeURIComponent(pathname || '').replace(/^\/+|\/+$/g, '');
    return name || null;
  } catch (_error) {
    return null;
  }
}

function assertDemoSeedAllowed(env = process.env, uri = config.database.uri) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Demo finance report seed is disabled in production');
  }
  if (env.ALLOW_ANALYTICS_DEMO_SEED !== 'true') {
    throw new Error('Set ALLOW_ANALYTICS_DEMO_SEED=true to run the demo finance report seed');
  }
  if (databaseNameFromUri(uri) !== DEMO_DATABASE_NAME) {
    throw new Error(`Demo finance report seed requires database ${DEMO_DATABASE_NAME}`);
  }
}

function parseCliArguments(argv = []) {
  const flags = new Set(argv);
  const unsupported = [...flags].filter((flag) => !['--apply', '--reset'].includes(flag));
  if (unsupported.length) throw new Error(`Unsupported argument: ${unsupported[0]}`);
  return {
    apply: flags.has('--apply'),
    reset: flags.has('--reset'),
  };
}

async function resetDemoFinanceReportData(dependencies = {}) {
  const OrderModel = dependencies.Order || Order;
  const OrderItemModel = dependencies.OrderItem || OrderItem;
  const FinanceSnapshotModel = dependencies.FinanceSnapshot || FinanceSnapshot;
  const AdsSpendDailyModel = dependencies.AdsSpendDaily || AdsSpendDaily;
  const MarketplaceSettlementModel = dependencies.MarketplaceSettlement || MarketplaceSettlement;
  const LedgerModel = dependencies.MarketplaceSettlementLedgerLine || MarketplaceSettlementLedgerLine;
  const demoOrders = await OrderModel.find({ externalOrderId: { $regex: '^DEMO-FIN-' } }).select('_id').lean();
  const orderIds = demoOrders.map((order) => order._id);
  const demoItems = orderIds.length ? await OrderItemModel.find({ orderId: { $in: orderIds } }).select('_id').lean() : [];
  const itemIds = demoItems.map((item) => item._id);
  const [ledger, settlements, ads, snapshots, items, orders] = await Promise.all([
    LedgerModel.deleteMany({ sourceRef: DEMO_SOURCE_REF }),
    MarketplaceSettlementModel.deleteMany({ sourceRef: DEMO_SOURCE_REF }),
    AdsSpendDailyModel.deleteMany({ sourceRef: DEMO_SOURCE_REF }),
    itemIds.length ? FinanceSnapshotModel.deleteMany({ orderItemId: { $in: itemIds } }) : { deletedCount: 0 },
    orderIds.length ? OrderItemModel.deleteMany({ orderId: { $in: orderIds } }) : { deletedCount: 0 },
    orderIds.length ? OrderModel.deleteMany({ _id: { $in: orderIds } }) : { deletedCount: 0 },
  ]);
  return {
    deletedLedger: ledger.deletedCount || 0, deletedSettlements: settlements.deletedCount || 0, deletedAds: ads.deletedCount || 0,
    deletedSnapshots: snapshots.deletedCount || 0, deletedOrderItems: items.deletedCount || 0, deletedOrders: orders.deletedCount || 0,
  };
}

async function seedDemoFinanceReportData({
  apply = false,
  reset = false,
  env = process.env,
  dependencies = {},
} = {}) {
  const databaseUri = dependencies.databaseUri || config.database.uri;
  const connect = dependencies.connectDatabase || connectDatabase;
  const disconnect = dependencies.disconnectDatabase || disconnectDatabase;
  const seedShops = dependencies.upsertDemoShops || upsertDemoShops;
  const OrderModel = dependencies.Order || Order;
  const OrderItemModel = dependencies.OrderItem || OrderItem;
  const FinanceSnapshotModel = dependencies.FinanceSnapshot || FinanceSnapshot;
  const AdsSpendDailyModel = dependencies.AdsSpendDaily || AdsSpendDaily;
  const MarketplaceSettlementModel = dependencies.MarketplaceSettlement || MarketplaceSettlement;
  const LedgerModel = dependencies.MarketplaceSettlementLedgerLine || MarketplaceSettlementLedgerLine;
  assertDemoSeedAllowed(env, databaseUri);

  const rows = buildDemoFinanceRows();
  const ads = buildDemoAds(rows);
  const settlements = buildDemoSettlements(rows);
  const ledger = buildDemoLedger(rows, settlements);
  const summary = {
    orderCount: rows.length,
    orderItemCount: rows.length,
    snapshotCount: rows.length,
    adsCount: ads.length,
    settlementCount: settlements.length,
    ledgerCount: ledger.length,
  };

  if (!apply) {
    return {
      apply: false,
      databaseName: databaseNameFromUri(databaseUri),
      reset,
      sourceRef: DEMO_SOURCE_REF,
      ...summary,
    };
  }

  await connect();
  try {
    const resetResult = reset ? await resetDemoFinanceReportData({ Order: OrderModel, OrderItem: OrderItemModel, FinanceSnapshot: FinanceSnapshotModel, AdsSpendDaily: AdsSpendDailyModel, MarketplaceSettlement: MarketplaceSettlementModel, MarketplaceSettlementLedgerLine: LedgerModel }) : null;
    await seedShops();
    await OrderModel.bulkWrite(rows.map(({ order }) => ({
      updateOne: {
        filter: { salesChannelCode: order.salesChannelCode, marketplaceCode: order.marketplaceCode, externalOrderId: order.externalOrderId },
        update: { $setOnInsert: order }, upsert: true,
      },
    })), { ordered: false, timestamps: false });
    const orders = await OrderModel.find({ externalOrderId: { $in: rows.map((row) => row.order.externalOrderId) } })
      .select('_id externalOrderId shopId salesChannelCode marketplaceCode').lean();
    const ordersByExternalId = new Map(orders.map((order) => [order.externalOrderId, order]));
    await OrderItemModel.bulkWrite(rows.map(({ order, item }) => {
      const resolvedOrder = ordersByExternalId.get(order.externalOrderId);
      if (!resolvedOrder) throw new Error(`Demo order resolution failed for ${order.externalOrderId}`);
      return { updateOne: { filter: { orderId: resolvedOrder._id, externalItemId: item.externalItemId }, update: { $setOnInsert: { ...item, orderId: resolvedOrder._id, shopId: resolvedOrder.shopId, salesChannelCode: resolvedOrder.salesChannelCode, marketplaceCode: resolvedOrder.marketplaceCode } }, upsert: true } };
    }), { ordered: false, timestamps: false });
    const items = await OrderItemModel.find({ externalItemId: { $in: rows.map((row) => row.item.externalItemId) } })
      .select('_id orderId externalOrderId externalItemId shopId salesChannelCode marketplaceCode').lean();
    const itemsByExternalId = new Map(items.map((item) => [item.externalItemId, item]));
    await FinanceSnapshotModel.bulkWrite(rows.map(({ order, item, snapshot }) => {
      const resolvedOrder = ordersByExternalId.get(order.externalOrderId);
      const resolvedItem = itemsByExternalId.get(item.externalItemId);
      return { updateOne: { filter: { orderItemId: resolvedItem._id }, update: { $setOnInsert: { ...snapshot, orderId: resolvedOrder._id, orderItemId: resolvedItem._id, shopId: resolvedOrder.shopId, salesChannelCode: resolvedOrder.salesChannelCode, marketplaceCode: resolvedOrder.marketplaceCode, currency: 'USD' } }, upsert: true } };
    }), { ordered: false, timestamps: false });
    await AdsSpendDailyModel.bulkWrite(ads.map((ad) => ({ updateOne: { filter: { shopId: ad.shopId, salesChannelCode: ad.salesChannelCode, marketplaceCode: ad.marketplaceCode, reportDate: ad.reportDate, campaignName: ad.campaignName }, update: { $setOnInsert: ad }, upsert: true } })), { ordered: false, timestamps: false });
    await MarketplaceSettlementModel.bulkWrite(settlements.map(({ rowIndexes, ...settlement }) => ({ updateOne: { filter: { shopId: settlement.shopId, salesChannelCode: settlement.salesChannelCode, marketplaceCode: settlement.marketplaceCode, settlementId: settlement.settlementId }, update: { $setOnInsert: settlement }, upsert: true } })), { ordered: false, timestamps: false });
    await LedgerModel.bulkWrite(ledger.map((line) => {
      const linkedItem = itemsByExternalId.get(line.externalItemId);
      const linkedOrder = linkedItem ? ordersByExternalId.get(linkedItem.externalOrderId) : null;
      return { updateOne: { filter: { shopId: line.shopId, salesChannelCode: line.salesChannelCode, marketplaceCode: line.marketplaceCode, ledgerCategory: line.ledgerCategory, 'rawReference.dedupKey': line.rawReference.dedupKey }, update: { $setOnInsert: { ...line, ...(linkedOrder ? { orderId: linkedOrder._id } : {}), ...(linkedItem ? { orderItemId: linkedItem._id } : {}) } }, upsert: true } };
    }), { ordered: false, timestamps: false });
    return { apply: true, databaseName: databaseNameFromUri(databaseUri), reset, sourceRef: DEMO_SOURCE_REF, ...summary, ...(resetResult ? { resetResult } : {}) };
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  const options = parseCliArguments(process.argv.slice(2));
  seedDemoFinanceReportData(options)
    .then((result) => logger.info('demo_finance_report_seed_completed', result))
    .catch((error) => {
      logger.error('demo_finance_report_seed_failed', { error });
      process.exitCode = 1;
    });
}

module.exports = {
  DEMO_DATABASE_NAME,
  DEMO_SOURCE_REF,
  assertDemoSeedAllowed,
  databaseNameFromUri,
  buildDemoFinanceRows,
  buildDemoAds,
  buildDemoSettlements,
  buildDemoLedger,
  parseCliArguments,
  resetDemoFinanceReportData,
  seedDemoFinanceReportData,
};
