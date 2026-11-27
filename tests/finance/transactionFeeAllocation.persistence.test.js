const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
jest.mock('../../src/modules/order/public', () => ({ findByExternalIdentity: jest.fn(), listItemsByOrder: jest.fn() }));
jest.mock('../../src/modules/finance/services/financeSnapshot.service', () => ({ recalculateOrder: jest.fn() }));
const orderPublic = require('../../src/modules/order/public');
const snapshot = require('../../src/modules/finance/services/financeSnapshot.service');
const service = require('../../src/modules/finance/services/transactionFeeAllocation.service');
const repository = require('../../src/modules/finance/repositories/financeImport.repository');
const Fee = require('../../src/modules/finance/models/marketplaceFeeLine.model');
const Ledger = require('../../src/modules/finance/models/marketplaceSettlementLedgerLine.model');
const Audit = require('../../src/modules/audit/models/auditEvent.model');
let db;
const shopId = new mongoose.Types.ObjectId();
const orderId = new mongoose.Types.ObjectId();
const a = new mongoose.Types.ObjectId('660000000000000000140002');
const b = new mongoose.Types.ObjectId('660000000000000000140003');
const base = { shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US', externalOrderId: '114-1', sourceRef: 'old.csv', currency: 'USD' };
jest.setTimeout(120000);
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('transaction_allocation_test'));
  await Promise.all([Fee.init(), Ledger.init(), Audit.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db.stop(); });
beforeEach(async () => {
  await Promise.all([Fee.deleteMany({}), Ledger.deleteMany({}), Audit.deleteMany({})]);
  jest.clearAllMocks();
  orderPublic.findByExternalIdentity.mockResolvedValue({ _id: orderId });
  orderPublic.listItemsByOrder.mockResolvedValue([
    { _id: a, price: { itemPriceAmount: 2000, currency: 'USD' } },
    { _id: b, price: { itemPriceAmount: 3000, currency: 'USD' } },
  ]);
  snapshot.recalculateOrder.mockResolvedValue({});
});
async function seed() {
  await Ledger.create({ ...base, ledgerCategory: 'TRANSACTION', amount: 4499, rawReference: { dedupKey: 'sale', importKey: '1' } });
  await Fee.create({ ...base, feeType: 'SELLING_FEES', totalFeeAmount: 501, rawReference: { dedupKey: 'sale:SELLING_FEES', importKey: '1:SELLING_FEES' } });
}
test('historical dry-run is read-only; apply and replay preserve fee total and per-item evidence', async () => {
  await seed();
  const options = { beforeId: new mongoose.Types.ObjectId('ffffffffffffffffffffffff') };
  expect(await service.backfillTransactionFees(options)).toMatchObject({ checked: 1, linked: 1, feeRows: 1, allocatedItems: 2, failed: [] });
  expect((await Fee.findOne().lean()).allocations).toBeUndefined();
  expect((await Ledger.findOne().lean()).orderId).toBeNull();
  expect(snapshot.recalculateOrder).not.toHaveBeenCalled();
  const applied = await service.backfillTransactionFees({ ...options, dryRun: false });
  expect(applied).toMatchObject({ recalculatedOrders: 1, failed: [] });
  expect(await repository.sumFeesByOrderItem(a)).toBe(200);
  expect(await repository.sumFeesByOrderItem(b)).toBe(301);
  expect(await repository.hasAllocatedFeesByOrderItem(a)).toBe(true);
  expect(await repository.listSourceReferencesByOrderItem(a)).toEqual(expect.arrayContaining([expect.objectContaining({ sourceKind: 'FEE', amount: 200, allocationMethod: 'ITEM_VALUE' })]));
  expect(await repository.latestFinancialInputTimes([a, b])).toHaveLength(2);
  expect((await Ledger.findOne().lean()).orderId).toEqual(orderId);
  expect(await service.backfillTransactionFees({ ...options, dryRun: false })).toMatchObject({ failed: [] });
  expect(await Fee.countDocuments()).toBe(1);
  expect((await Fee.findOne().lean()).totalFeeAmount).toBe(501);
  expect(await Audit.countDocuments()).toBe(1);
});
test('allocated fee credits and direct item fees sum once, including zero allocation', async () => {
  await Fee.create({ ...base, orderId, feeType: 'SELLING_FEES', totalFeeAmount: -5,
    allocationMethod: 'ITEM_VALUE', allocations: [{ orderItemId: a, amount: -5 }, { orderItemId: b, amount: 0 }] });
  await Fee.create({ ...base, orderId, orderItemId: a, feeType: 'OTHER_TRANSACTION_FEES', totalFeeAmount: 10 });
  expect(await repository.sumFeesByOrderItem(a)).toBe(5);
  expect(await repository.sumFeesByOrderItem(b)).toBe(0);
  expect(await repository.sumFeesByOrderItem(new mongoose.Types.ObjectId())).toBeNull();
});
test('does not link or mutate when currency prevents allocation', async () => {
  await seed();
  orderPublic.listItemsByOrder.mockResolvedValue([{ _id: a, price: { currency: 'EUR', itemPriceAmount: 100 } }]);
  const result = await service.backfillTransactionFees({ beforeId: new mongoose.Types.ObjectId('ffffffffffffffffffffffff'), dryRun: false });
  expect(result.unresolved).toHaveLength(1);
  expect((await Ledger.findOne().lean()).orderId).toBeNull();
  expect(snapshot.recalculateOrder).not.toHaveBeenCalled();
});

test('rolls back fee and ledger writes together when audit fails', async () => {
  await seed();
  const audit = require('../../src/modules/audit/public');
  const record = jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit unavailable'));
  try {
    const result = await service.backfillTransactionFees({ beforeId: new mongoose.Types.ObjectId('ffffffffffffffffffffffff'), dryRun: false });
    expect(result.failed).toHaveLength(1);
    expect((await Fee.findOne().lean()).allocations).toBeUndefined();
    expect((await Ledger.findOne().lean()).orderId).toBeNull();
    expect(snapshot.recalculateOrder).not.toHaveBeenCalled();
  } finally { record.mockRestore(); }
});
