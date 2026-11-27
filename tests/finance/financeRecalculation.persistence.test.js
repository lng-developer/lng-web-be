const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../src/config/queue', () => ({ createQueue: () => ({ add: mockAdd }) }));
jest.mock('../../src/modules/order/public', () => ({ findItemById: jest.fn(), pageItemIds: jest.fn(), findItemsByIds: jest.fn(), listItemsByOrder: jest.fn() }));
jest.mock('../../src/modules/mapping/public', () => ({ getFulfillmentPlanForOrderItem: jest.fn(), listFulfillmentPlansForOrderItems: jest.fn() }));
jest.mock('../../src/modules/shipment/public', () => ({ getShipmentByOrderItem: jest.fn() }));
jest.mock('../../src/modules/vendorSubmission/public', () => ({ previewCostForOrderItem: jest.fn().mockResolvedValue(null) }));

const config = require('../../src/config');
const order = require('../../src/modules/order/public');
const mapping = require('../../src/modules/mapping/public');
const audit = require('../../src/modules/audit/public');
const Audit = require('../../src/modules/audit/models/auditEvent.model');
const Batch = require('../../src/modules/finance/models/financeImportBatch.model');
const Fee = require('../../src/modules/finance/models/marketplaceFeeLine.model');
const Refund = require('../../src/modules/finance/models/refundRecord.model');
const Snapshot = require('../../src/modules/finance/models/financeSnapshot.model');
const Request = require('../../src/modules/finance/models/financeRecalculationRequest.model');
const Guard = require('../../src/modules/finance/models/financeRecalculationGuard.model');
const requests = require('../../src/modules/finance/repositories/financeRecalculationRequest.repository');
const queue = require('../../src/modules/finance/services/financeSnapshotQueue.service');
const importService = require('../../src/modules/finance/services/financeImport.service');
const importRepository = require('../../src/modules/finance/repositories/financeImport.repository');
const service = require('../../src/modules/finance/services/financeSnapshot.service');
const reconciliation = require('../../src/modules/finance/services/financeSnapshotReconciliation.service');

const mockAdd = jest.fn();
const id = () => String(new mongoose.Types.ObjectId());
jest.setTimeout(120000);
let database;
beforeAll(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri('finance_request_test'));
  await Promise.all([Batch, Request, Guard, Snapshot, Audit].map((model) => model.init()));
  config.finance = { ...config.finance, durableRecalculationEnabled: true };
  config.redis.enabled = true;
});
afterAll(async () => { await mongoose.disconnect(); await database.stop(); });
beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await Promise.all([Batch, Request, Guard, Snapshot, Audit].map((model) => model.deleteMany({})));
  mockAdd.mockResolvedValue({ id: 'queued' });
  mapping.listFulfillmentPlansForOrderItems.mockResolvedValue([]);
});
function source() {
  const item = { _id: id(), orderId: id(), shopId: id(), orderedAt: new Date(), sku: '1',
    salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', price: { itemPriceAmount: 5000, currency: 'USD' } };
  order.findItemById.mockImplementation(async () => ({ ...item, price: { ...item.price } }));
  order.listItemsByOrder.mockResolvedValue([item]);
  return item;
}

test('notification loss recovers, transaction abort leaves no request, duplicate delivery after commit is harmless', async () => {
  const item = source();
  await expect(mongoose.connection.transaction(async (session) => {
    await queue.enqueueSnapshotRecalculation({ orderItemId: item._id }, { session });
    throw new Error('abort');
  })).rejects.toThrow('abort');
  expect(await Request.countDocuments()).toBe(0);
  expect(mockAdd).not.toHaveBeenCalled();
  mockAdd.mockRejectedValueOnce(new Error('Redis unavailable'));
  expect(await queue.enqueueSnapshotRecalculation({ orderItemId: item._id })).toMatchObject({ persisted: true, queued: false });
  await queue.recoverPendingRequests();
  expect(mockAdd).toHaveBeenCalledTimes(2);
  await service.processRecalculationRequest(item._id);
  await service.processRecalculationRequest(item._id);
  expect(await Audit.countDocuments()).toBe(1);
  expect(await requests.findPending(item._id)).toBeNull();
});

test('source update during computation converges and both batch counters settle once', async () => {
  const item = source();
  const batchIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  await Batch.collection.insertMany(batchIds.map((_id) => ({ _id, recalculationStatus: 'PROCESSING', recalculationTotal: 1 })));
  await requests.request({ orderItemId: item._id, importBatchId: batchIds[0] });
  mapping.getFulfillmentPlanForOrderItem.mockImplementationOnce(async () => {
    item.price.itemPriceAmount = 7200;
    await requests.request({ orderItemId: item._id, importBatchId: batchIds[1] });
    return null;
  });
  await service.processRecalculationRequest(item._id);
  await Promise.all([service.processRecalculationRequest(item._id), service.processRecalculationRequest(item._id)]);
  expect((await Snapshot.findOne({ orderItemId: item._id }).lean()).customerPaidAmount).toBe(7200);
  expect(await Request.findById(item._id).lean()).toMatchObject({ completedVersion: 2, pending: false, batchIds: [] });
  for (const batchId of batchIds) expect(await Batch.findById(batchId).lean()).toMatchObject({
    recalculationStatus: 'COMPLETED', recalculationCompleted: 1,
  });
});

test('audit rollback keeps the durable request, exhausted batch item is counted once', async () => {
  const item = source();
  const batchId = new mongoose.Types.ObjectId();
  await Batch.collection.insertOne({ _id: batchId, recalculationStatus: 'PROCESSING', recalculationTotal: 1 });
  await requests.request({ orderItemId: item._id, importBatchId: batchId });
  jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit unavailable'));
  await expect(service.processRecalculationRequest(item._id)).rejects.toThrow('audit unavailable');
  expect(await Snapshot.countDocuments()).toBe(0);
  await service.recordFailedRequest(item._id, 1, new Error('unavailable'));
  await service.recordFailedRequest(item._id, 1, new Error('unavailable'));
  await queue.recoverPendingRequests();
  expect(mockAdd).not.toHaveBeenCalled();
  expect(await Request.findById(item._id).lean()).toMatchObject({ pending: false, failedVersion: 1, lastError: 'unavailable' });
  expect(await Snapshot.countDocuments()).toBe(0);
  await queue.enqueueSnapshotRecalculation({ orderItemId: item._id, reason: 'MANUAL_RETRY' });
  await service.recordFailedRequest(item._id, 1, new Error('late failure'));
  await service.processRecalculationRequest(item._id);
  expect(await Snapshot.countDocuments()).toBe(1);
  expect(await Batch.findById(batchId).lean()).toMatchObject({ recalculationStatus: 'PARTIAL_FAILED', recalculationFailed: 1 });
  expect(await requests.findPending(item._id)).toBeNull();
});

test('manual order, item and vendor writes serialize through the order guard', async () => {
  const item = source();
  await service.recalculateOrderItem(item._id, { system: true });
  await requests.request({ orderItemId: item._id });
  await Promise.all([
    service.processRecalculationRequest(item._id),
    service.recalculateOrder(item.orderId, { system: true }),
    service.updateActualVendorCost(item._id, { totalAmount: 1500 }),
  ]);
  const snapshot = await Snapshot.findOne({ orderItemId: item._id }).lean();
  expect(snapshot.actualVendorTotalAmount).toBe(1500);
  expect(snapshot.calculationHistory).toHaveLength(4);
  expect(await Audit.countDocuments()).toBe(3);
});

test('stale vendor events and replacement identities cannot erase an incurred charge', async () => {
  const item = source();
  await service.recalculateOrderItem(item._id, { system: true });
  const cost = { totalAmount: 1500, currency: 'USD', capturedAt: new Date('2026-11-27T10:00:00Z'), allocation: { vendorOrderId: 'remote-1' } };
  await service.updateActualVendorCost(item._id, cost);
  await service.updateActualVendorCost(item._id, { ...cost, totalAmount: 100, capturedAt: new Date('2026-11-26T10:00:00Z') });
  expect((await Snapshot.findOne({ orderItemId: item._id }).lean()).actualVendorTotalAmount).toBe(1500);
  await expect(service.updateActualVendorCost(item._id, { ...cost, totalAmount: 100, allocation: { vendorOrderId: 'replacement' } })).rejects.toThrow('reconciliation');
});

test('canonical backfill dry-run is read-only and apply/rollback preserve guarded snapshots', async () => {
  const item = source();
  const plan = { costEstimate: { totalAmount: 2000, lines: [{ code: 'BASE_COST', amount: 1700 }] } };
  mapping.getFulfillmentPlanForOrderItem.mockResolvedValueOnce(plan).mockResolvedValueOnce(plan).mockResolvedValueOnce(plan);
  await service.recalculateOrderItem(item._id, { system: true });
  await Snapshot.updateOne({ orderItemId: item._id }, { $set: { calculationVersion: 1, grossProfitAmount: -1000 } });
  const before = await Snapshot.findOne({ orderItemId: item._id }).lean();
  const { runBackfill, rollbackBackfill } = require('../../src/modules/finance/services/financeCanonicalBackfill.service');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(item.orderedAt);
  const options = { database: mongoose.connection.name, expectDatabase: mongoose.connection.name, seller: '1', from: date, to: date };
  const manifest = await runBackfill(options);
  expect(manifest.entries[0]).toMatchObject({ status: 'READY', after: { profitBeforeAdsAmount: 2250 } });
  expect(await Snapshot.findOne({ orderItemId: item._id }).lean()).toEqual(before);
  await runBackfill({ ...options, resume: manifest, apply: true }, { save: jest.fn() });
  expect(manifest.entries[0].status).toBe('APPLIED');
  expect((await Snapshot.findOne({ orderItemId: item._id }).lean()).profitBeforeAdsAmount).toBe(2250);
  expect(await Audit.countDocuments({ action: 'FINANCE_CANONICAL_BACKFILL_APPLIED' })).toBe(1);
  await rollbackBackfill({ ...options, resume: manifest }, { save: jest.fn() });
  expect(manifest.entries[0].status).toBe('ROLLED_BACK');
  expect((await Snapshot.findOne({ orderItemId: item._id }).lean()).grossProfitAmount).toBe(-1000);
});

test('default worker configuration serializes concurrent vendor events and identical replay preserves revision', async () => {
  config.finance.durableRecalculationEnabled = false;
  try {
    const item = source();
    await service.recalculateOrderItem(item._id, { system: true });
    const latest = { totalAmount: 1500, currency: 'USD', capturedAt: new Date('2026-11-27T12:00:00Z') };
    await Promise.all([
      service.updateActualVendorCost(item._id, latest),
      service.updateActualVendorCost(item._id, { ...latest, totalAmount: 100, capturedAt: new Date('2026-11-26T12:00:00Z') }),
    ]);
    const before = await Snapshot.findOne({ orderItemId: item._id }).lean();
    expect(before.actualVendorTotalAmount).toBe(1500);
    await service.updateActualVendorCost(item._id, latest);
    const after = await Snapshot.findOne({ orderItemId: item._id }).lean();
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.calculationHistory).toEqual(before.calculationHistory);
  } finally { config.finance.durableRecalculationEnabled = true; }
});

test('vendor charge arriving before the initial snapshot is retained', async () => {
  const item = source();
  await service.updateActualVendorCost(item._id, { totalAmount: 1200, currency: 'USD', source: 'MANGOTEE_ORDER_RESPONSE' });
  const snapshot = await Snapshot.findOne({ orderItemId: item._id }).lean();
  expect(snapshot).toMatchObject({ actualVendorTotalAmount: 1200, effectiveFulfillmentCostAmount: 1200, profitBeforeAdsAmount: 3050 });
});

test('rolling cursor repairs an existing stale snapshot after a source write with no request', async () => {
  const item = source();
  await service.recalculateOrderItem(item._id, { system: true });
  const snapshot = await Snapshot.findOne({ orderItemId: item._id }).lean();
  const updatedAt = new Date(snapshot.calculatedAt.getTime() + 1);
  item.price.itemPriceAmount = 7600;
  const blocked = id();
  await requests.request({ orderItemId: blocked });
  await service.recordFailedRequest(blocked, 1, new Error('missing item'));
  order.findItemsByIds.mockResolvedValueOnce([{ _id: blocked, updatedAt }]).mockResolvedValueOnce([{ _id: item._id, updatedAt }]);
  order.pageItemIds.mockResolvedValueOnce([blocked]).mockResolvedValueOnce([item._id]);
  await reconciliation.refreshAgedSnapshots(1);
  expect(await requests.findPending(blocked)).toBeNull();
  await reconciliation.refreshAgedSnapshots(1);
  expect(order.pageItemIds).toHaveBeenLastCalledWith(blocked, 1);
  await service.processRecalculationRequest(item._id);
  expect((await Snapshot.findOne({ orderItemId: item._id }).lean()).customerPaidAmount).toBe(7600);
});

test.each(['fee', 'direct refund', 'allocated refund', 'plan'])('rolling scan detects recent %s changes without a request', async (kind) => {
  const item = source();
  await service.recalculateOrderItem(item._id, { system: true });
  const snapshot = await Snapshot.findOne({ orderItemId: item._id }).lean();
  const updatedAt = new Date(snapshot.calculatedAt.getTime() + 1);
  const orderItemId = new mongoose.Types.ObjectId(item._id);
  const unrelated = new mongoose.Types.ObjectId();
  if (kind === 'fee') await Fee.collection.insertOne({ orderItemId, totalFeeAmount: 200, updatedAt });
  if (kind === 'direct refund') await Refund.collection.insertOne({ orderItemId, totalRefundAmount: 220, updatedAt });
  if (kind === 'allocated refund') await Refund.collection.insertOne({ allocations: [
    { orderItemId, amount: 220 }, { orderItemId: unrelated, amount: 300 },
  ], updatedAt });
  if (kind === 'plan') mapping.listFulfillmentPlansForOrderItems.mockResolvedValue([{ orderItemId: item._id, updatedAt }]);
  order.pageItemIds.mockResolvedValueOnce([item._id]);
  order.findItemsByIds.mockResolvedValueOnce([item]);
  await reconciliation.refreshAgedSnapshots();
  expect(await requests.findPending(item._id)).toBeTruthy();
  expect(await requests.findPending(String(unrelated))).toBeNull();
  await service.processRecalculationRequest(item._id);
  const result = await Snapshot.findOne({ orderItemId }).lean();
  if (kind === 'fee') expect(result.feeAmount).toBe(200);
  if (kind.includes('refund')) expect(result.refundAmount).toBe(220);
});

test.each([[20, 30, 2], [60, 50, 1]])('concurrent allocations %i + %i preserve committed amounts and requests', async (first, second, accepted) => {
  const item = source();
  const refundId = new mongoose.Types.ObjectId();
  await Refund.collection.insertOne({ _id: refundId, shopId: new mongoose.Types.ObjectId(item.shopId),
    salesChannelCode: item.salesChannelCode, marketplaceCode: item.marketplaceCode, totalRefundAmount: 100, allocations: [] });
  const itemIds = [id(), id()];
  const find = importRepository.findRefundById;
  let reads = 0;
  let release;
  const bothRead = new Promise((resolve) => { release = resolve; });
  jest.spyOn(importRepository, 'findRefundById').mockImplementation(async (...args) => {
    const refund = await find(...args);
    if (++reads === 2) release();
    await bothRead;
    return refund;
  });
  const results = await Promise.allSettled([first, second].map((amount, index) =>
    importService.allocateRefund(String(refundId), [{ orderItemId: itemIds[index], amount }], { system: true })));
  const amounts = [first, second];
  const committed = results.flatMap((result, index) => result.status === 'fulfilled'
    ? [{ orderItemId: itemIds[index], amount: amounts[index] }] : []);
  for (const result of results) {
    if (result.status === 'rejected' && result.reason.message !== 'Allocation exceeds refund amount') throw result.reason;
  }
  expect(committed).toHaveLength(accepted);
  const saved = await Refund.findById(refundId).lean();
  expect(saved.allocations.map((entry) => ({ ...entry, orderItemId: String(entry.orderItemId) })))
    .toEqual(expect.arrayContaining(committed));
  expect(saved.allocations).toHaveLength(accepted);
  expect(await Request.countDocuments({ pending: true })).toBe(accepted);
  for (const result of results.filter((entry) => entry.status === 'rejected')) {
    expect(result.reason.message).toBe('Allocation exceeds refund amount');
  }
});

test('resume crosses a page already covered by snapshots', async () => {
  const item = source();
  await service.recalculateOrderItem(item._id, { system: true });
  const missing = id();
  order.pageItemIds.mockResolvedValueOnce([item._id]).mockResolvedValueOnce([missing]);
  expect(await reconciliation.reconcileSnapshots({ limit: 1, dryRun: false })).toMatchObject({ eligible: 0 });
  expect(await reconciliation.reconcileSnapshots({ limit: 1, dryRun: false })).toMatchObject({ queued: 1 });
  expect(order.pageItemIds).toHaveBeenLastCalledWith(item._id, 1);
  expect(await requests.findPending(missing)).toBeTruthy();
});
