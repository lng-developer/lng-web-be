const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Snapshot = require('../../src/modules/finance/models/financeSnapshot.model');
const repository = require('../../src/modules/finance/repositories/financeSnapshot.repository');
const { calculateSnapshotFinancials } = require('../../src/modules/finance/services/financeCalculation.service');
let db;
jest.setTimeout(120000);
beforeAll(async () => { db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri('finance_consistency_test')); });
afterAll(async () => { await mongoose.disconnect(); await db.stop(); });
beforeEach(async () => { await Snapshot.deleteMany({}); });

test('does not turn unknown stored profit into zero when cost is present', async () => {
  await Snapshot.create({ orderId: new mongoose.Types.ObjectId(), orderItemId: new mongoose.Types.ObjectId(),
    shopId: new mongoose.Types.ObjectId(), currency: 'USD', orderedAt: new Date(),
    salesChannelCode: 'AMAZON', marketplaceCode: 'US', customerPaidAmount: 1000,
    totalCostAmount: 200, effectiveFulfillmentCostAmount: 200, calculationVersion: 2, profitBeforeAdsAmount: null });
  expect((await repository.summarizeOrderPnl({}))[0].profitAmount).toBeNull();
  expect((await repository.summarizeDaily({}))[0].grossProfitAmount).toBeNull();
  const orders = await repository.listOrderProfitability({});
  expect(orders.items[0].profitAmount).toBeNull();
  expect(orders.summaryByCurrency[0].profitAmount).toBeNull();
  expect(orders.summaryByCurrency[0].totalCostAmount).toBe(200);
});
test('item, order, daily and seller totals agree independently of pagination', async () => {
  const shopId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  const source = { orderId, shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US', currency: 'USD', sellerEmployeeCode: 'J2503', orderedAt: new Date('2026-11-24T10:00:00Z'), customerPaidAmount: 3080, netRevenueAmount: 2980, refundAmount: 100, feeAmount: 225, feeConfidence: 'ALLOCATED', totalCostAmount: 1400, baseCostAmount: 1000, costStatus: 'PRESENT', actualVendorTotalAmount: 1188, actualVendorCurrency: 'USD' };
  for (let i = 0; i < 3; i++) {
    const canonical = calculateSnapshotFinancials(source);
    await Snapshot.create({ ...source, ...canonical, orderItemId: new mongoose.Types.ObjectId(), grossProfitAmount: canonical.profitBeforeAdsAmount });
  }
  const query = { sellerEmployeeCode: 'J2503' };
  const [orders, daily, sellers, summary] = await Promise.all([repository.listOrderProfitability({ ...query, limit: 1 }), repository.summarizeDaily(query), repository.summarizeBySeller(query), repository.summarizeOrderPnl(query)]);
  expect(orders.items[0]).toMatchObject({ totalCostAmount: 3564, profitAmount: 4701, refundAmount: 300 });
  expect(daily.reduce((sum, row) => sum + row.grossProfitAmount, 0)).toBe(4701);
  expect(sellers.reduce((sum, row) => sum + row.grossProfitAmount, 0)).toBe(4701);
  expect(summary[0]).toMatchObject({ totalCostAmount: 3564, profitAmount: 4701, refundAmount: 300 });
  expect(orders.summaryByCurrency[0]).toMatchObject({ refundAmount: 300, totalCostAmount: 3564 });
  expect((await repository.listOrderProfitability({ ...query, page: 2, limit: 1 })).summaryByCurrency).toEqual(orders.summaryByCurrency);
  const grouped = await repository.list({ ...query, groupBy: 'ORDER', limit: 1 });
  expect(grouped.total).toBe(1);
  expect(grouped.items).toHaveLength(3);
  expect(grouped.groupedRows[0].profitAmount).toBe(4701);
});

test('keeps currencies and seller item scopes separate and does not present partial profit as complete', async () => {
  const orderId = new mongoose.Types.ObjectId();
  const shopId = new mongoose.Types.ObjectId();
  for (const [seller, currency, cost] of [['A', 'USD', 100], ['B', 'USD', 200], ['A', 'EUR', 50], ['A', 'USD', null]]) {
    const source = { orderId, shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US', currency, sellerEmployeeCode: seller, orderItemId: new mongoose.Types.ObjectId(), customerPaidAmount: 1000, totalCostAmount: cost, costStatus: cost === null ? 'MISSING' : 'PRESENT', orderedAt: new Date('2026-11-24T17:00:00Z') };
    await Snapshot.create({ ...source, ...calculateSnapshotFinancials(source) });
  }
  const rows = await repository.listOrderProfitability({ sellerEmployeeCode: 'A' });
  expect(rows.items).toHaveLength(2);
  expect(rows.summaryByCurrency.find(r => r.currency === 'EUR')).toMatchObject({ revenueAmount: 1000, profitAmount: 950 });
  expect(rows.summaryByCurrency.find(r => r.currency === 'USD')).toMatchObject({ revenueAmount: 2000, profitAmount: null, totalCostAmount: null, missingCostOrderCount: 1 });
  expect((await repository.summarizeDaily({ sellerEmployeeCode: 'A' })).every(r => r.date === '2026-11-25')).toBe(true);
});


test('mixed seller order ownership is explicit and distinct IDs survive daily aggregation', async () => {
  const orderId = new mongoose.Types.ObjectId();
  const shopId = new mongoose.Types.ObjectId();
  for (const seller of ['A', 'B']) {
    const source = { orderId, shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US', currency: 'USD', sellerEmployeeCode: seller,
      orderItemId: new mongoose.Types.ObjectId(), customerPaidAmount: 1000, totalCostAmount: 100, costStatus: 'PRESENT', orderedAt: new Date('2026-11-24T12:00:00Z') };
    await Snapshot.create({ ...source, ...calculateSnapshotFinancials(source) });
  }
  const result = await repository.listOrderProfitability({});
  expect(result.items[0].sellerEmployeeCode).toBeNull();
  const daily = await repository.summarizeSellerDaily({});
  expect(new Set(daily.flatMap(row => row.orderIds.map(String))).size).toBe(1);
  const Ads = require('../../src/modules/finance/models/adsSpendDaily.model');
  await Ads.collection.insertOne({ shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US', currency: 'USD', sellerEmployeeCode: 'A', reportDate: new Date('2026-11-24'), spendAmount: 20 });
  const profit = await repository.summarizeDailyProfit({});
  expect(profit[0]).toMatchObject({ profitBeforeAdsAmount: 1800, profitAfterAdsAmount: null, adsCoverage: 'MISSING' });
});

test('order source population uses purchase date and the selected authorized shop', async () => {
  const orderItems = require('../../src/modules/order/repositories/orderItem.repository');
  const orderId = new mongoose.Types.ObjectId();
  const shopId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('orders').insertOne({ _id: orderId, orderedAt: new Date('2026-11-24T12:00:00Z') });
  const itemId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('orderitems').insertOne({ _id: itemId, orderId, shopId, sku: 'J2503-A', price: { currency: 'USD' }, createdAt: new Date('2026-11-27') });
  expect(await orderItems.pageFinanceItems({ shopId, shopIds: [shopId], dateFrom: '2026-11-24', dateTo: '2026-11-25' })).toEqual([expect.objectContaining({ _id: itemId, currency: 'USD' })]);
  expect(await orderItems.pageFinanceItems({ shopId, shopIds: [] })).toEqual([]);
});
