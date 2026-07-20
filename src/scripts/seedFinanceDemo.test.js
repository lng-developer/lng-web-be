jest.mock('../config/database', () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));

jest.mock('../shared/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../modules/finance/models/financeSnapshot.model', () => ({ bulkWrite: jest.fn(), find: jest.fn() }));
jest.mock('../modules/finance/models/adsSpendDaily.model', () => ({ bulkWrite: jest.fn() }));
jest.mock('../modules/order/models/orderItem.model', () => ({ find: jest.fn() }));

const FinanceSnapshot = require('../modules/finance/models/financeSnapshot.model');
const AdsSpendDaily = require('../modules/finance/models/adsSpendDaily.model');
const OrderItem = require('../modules/order/models/orderItem.model');
const { buildDemoAdSpend, buildDemoSnapshot, seedFinanceDemo } = require('./seedFinanceDemo');

describe('buildDemoSnapshot', () => {
  it('creates deterministic minor-unit profit data without changing the order item', () => {
    const item = {
      _id: '660000000000000000000001',
      orderId: '660000000000000000000002',
      shopId: '660000000000000000000003',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'JTEST-DEMO-001',
      price: { currency: 'USD' },
    };
    const now = new Date('2026-07-20T12:00:00.000Z');

    const snapshot = buildDemoSnapshot(item, now);

    expect(buildDemoSnapshot(item, now)).toEqual(snapshot);
    expect(snapshot.customerPaidAmount).toBeGreaterThan(0);
    expect(snapshot.baseCostAmount).toBeGreaterThan(0);
    expect(snapshot.grossProfitAmount).toBe(
      snapshot.customerPaidAmount
        - snapshot.feeAmount
        - snapshot.refundAmount
        - snapshot.baseCostAmount
        - snapshot.discountAmount,
    );
    expect(snapshot.calculatedAt).toBeInstanceOf(Date);
    expect(snapshot.snapshotStatus).toBe('ESTIMATED');
  });

  it('creates deterministic positive daily ad spend using integer amounts and BPS', () => {
    const item = {
      _id: '660000000000000000000001',
      orderId: '660000000000000000000002',
      shopId: '660000000000000000000003',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'JTEST-DEMO-001',
      price: { currency: 'USD' },
    };
    const now = new Date('2026-07-20T12:00:00.000Z');
    const snapshot = buildDemoSnapshot(item, now);
    const adSpend = buildDemoAdSpend(item, snapshot);

    expect(buildDemoAdSpend(item, snapshot)).toEqual(adSpend);
    expect(adSpend.spendAmount).toBeGreaterThan(0);
    expect(adSpend.attributedSalesAmount).toBeGreaterThan(0);
    expect(adSpend.ctrBps).toBe(Math.round((adSpend.clicks / adSpend.impressions) * 10000));
    expect(adSpend.acosBps).toBe(Math.round((adSpend.spendAmount / adSpend.attributedSalesAmount) * 10000));
    expect(adSpend.roasBps).toBe(Math.round((adSpend.attributedSalesAmount / adSpend.spendAmount) * 10000));
    expect(adSpend.cpcAmount).toBe(Math.round(adSpend.spendAmount / adSpend.clicks));
    expect(adSpend.reportDate).toEqual(snapshot.calculatedAt);
  });

  it('uses insert-only bulk writes and does not mutate source order items on a normal seed', async () => {
    const item = {
      _id: '660000000000000000000001',
      orderId: '660000000000000000000002',
      shopId: '660000000000000000000003',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'JTEST-DEMO-001',
      price: { currency: 'USD' },
    };
    OrderItem.find.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([item]) }),
    });
    FinanceSnapshot.find.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });
    FinanceSnapshot.bulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
    AdsSpendDaily.bulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });

    await seedFinanceDemo();

    expect(FinanceSnapshot.bulkWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ updateOne: expect.objectContaining({ update: expect.objectContaining({ $setOnInsert: expect.any(Object) }) }) }),
    ]), expect.objectContaining({ timestamps: false }));
    expect(AdsSpendDaily.bulkWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ updateOne: expect.objectContaining({ update: expect.objectContaining({ $setOnInsert: expect.any(Object) }) }) }),
    ]), expect.objectContaining({ timestamps: false }));
    expect(OrderItem.find.mock.calls).toHaveLength(1);
    expect(FinanceSnapshot.find).toHaveBeenCalledWith({ orderItemId: { $in: [item._id] } });
  });
});
