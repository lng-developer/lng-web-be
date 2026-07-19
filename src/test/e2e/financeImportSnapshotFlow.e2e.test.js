jest.mock('../../modules/order/public', () => ({
  findItemByFinanceIdentity: jest.fn(),
  findItemById: jest.fn(),
}));

jest.mock('../../modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
}));

jest.mock('../../modules/shipment/public', () => ({
  getShipmentByOrderItem: jest.fn(),
}));

jest.mock('../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  findProfileByEmployeeCode: jest.fn(),
}));

jest.mock('../../modules/organization/public', () => ({
  listAccountOrganizationSummaries: jest.fn(),
}));

jest.mock('../../modules/finance/repositories/financeSnapshot.repository', () => ({
  upsertByOrderItem: jest.fn(),
}));

jest.mock('../../modules/finance/repositories/financeImport.repository', () => ({
  sumFeesByOrderItem: jest.fn(),
  sumRefundsByOrderItem: jest.fn(),
  upsertFeeLine: jest.fn(),
  upsertLedgerLine: jest.fn(),
  upsertRefundRecord: jest.fn(),
}));

const orderPublic = require('../../modules/order/public');
const mappingPublic = require('../../modules/mapping/public');
const shipmentPublic = require('../../modules/shipment/public');
const authPublic = require('../../modules/auth/public');
const snapshotRepository = require('../../modules/finance/repositories/financeSnapshot.repository');
const financeImportRepository = require('../../modules/finance/repositories/financeImport.repository');
const financeImportService = require('../../modules/finance/services/financeImport.service');
const financeSnapshotService = require('../../modules/finance/services/financeSnapshot.service');

const orderId = '660000000000000000140001';
const orderItemId = '660000000000000000140002';
const shopId = '660000000000000000140003';
const planId = '660000000000000000140004';
const snapshotId = '660000000000000000140099';
const writeAuth = { permissions: ['FINANCE:WRITE'] };
const context = {
  shopId,
  salesChannelCode: 'AMAZON',
  marketplaceCode: 'AMAZON_US',
  sourceRef: 'transaction.csv',
};

const item = {
  _id: orderItemId,
  orderId,
  shopId,
  salesChannelCode: 'AMAZON',
  marketplaceCode: 'AMAZON_US',
  sku: 'SKU-1',
  price: { itemPriceAmount: 5000, shippingPriceAmount: 0, currency: 'USD' },
  externalData: { finance: { feeAmount: 999, refundAmount: 888 } },
};

const transactionCsv = [
  '"date/time","settlement id","type","order id","sku","selling fees","other transaction fees","total"',
  '"Apr 15, 2026 3:48:00 AM PDT","262","Order","114-1","SKU-1","-3.25","-1.00","48.03"',
  '"Apr 16, 2026 3:48:00 AM PDT","262","Refund","114-1","SKU-1","0","0","-10.00"',
].join('\n');

let feeStore;
let refundStore;
let ledgerStore;

function sourceKey(payload) {
  return [
    payload.shopId,
    payload.salesChannelCode,
    payload.marketplaceCode,
    payload.sourceRef,
    payload.rawReference.importKey,
  ].join('|');
}

function sumForOrderItem(store, targetOrderItemId, amountKey) {
  const rows = [...store.values()].filter((row) => String(row.orderItemId) === String(targetOrderItemId));
  return rows.length ? rows.reduce((total, row) => total + row[amountKey], 0) : null;
}

beforeEach(() => {
  jest.resetAllMocks();
  feeStore = new Map();
  refundStore = new Map();
  ledgerStore = new Map();

  orderPublic.findItemByFinanceIdentity.mockResolvedValue(item);
  orderPublic.findItemById.mockResolvedValue(item);
  mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
    id: planId,
    costEstimate: { totalAmount: 2000, lines: [{ code: 'BASE_COST', amount: 2000 }] },
  });
  shipmentPublic.getShipmentByOrderItem.mockResolvedValue(null);
  authPublic.findProfileByEmployeeCode.mockResolvedValue(null);

  financeImportRepository.upsertLedgerLine.mockImplementation(async (payload) => {
    ledgerStore.set(sourceKey(payload), payload);
  });
  financeImportRepository.upsertFeeLine.mockImplementation(async (payload) => {
    feeStore.set(sourceKey(payload), payload);
  });
  financeImportRepository.upsertRefundRecord.mockImplementation(async (payload) => {
    refundStore.set([
      payload.shopId,
      payload.salesChannelCode,
      payload.marketplaceCode,
      payload.externalRefundId,
    ].join('|'), payload);
  });
  financeImportRepository.sumFeesByOrderItem.mockImplementation(async (id) => (
    sumForOrderItem(feeStore, id, 'totalFeeAmount')
  ));
  financeImportRepository.sumRefundsByOrderItem.mockImplementation(async (id) => (
    sumForOrderItem(refundStore, id, 'totalRefundAmount')
  ));
  snapshotRepository.upsertByOrderItem.mockImplementation(async (_id, payload) => ({
    _id: snapshotId,
    ...payload,
  }));
});

describe('finance import snapshot flow harness', () => {
  test('uses imported fee and refund minor units only after manual recalculation', async () => {
    await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);

    expect(snapshotRepository.upsertByOrderItem).not.toHaveBeenCalled();

    const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

    expect(snapshot.revenue).toMatchObject({
      customerPaidAmount: 5000,
      feeAmount: 425,
      refundAmount: 1000,
    });
    expect(snapshot.margin).toMatchObject({ grossProfitAmount: 1575 });
  });

  test('keeps profit and margin null when imported money exists but fulfillment cost is missing', async () => {
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({ id: planId });
    await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);

    const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

    expect(snapshot.revenue).toMatchObject({ feeAmount: 425, refundAmount: 1000 });
    expect(snapshot).toMatchObject({ snapshotStatus: 'MISSING_COST' });
    expect(snapshot.margin).toEqual({ grossProfitAmount: null, grossMarginBps: null });
  });

  test('does not multiply source totals when the same source is imported twice', async () => {
    await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);
    await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);

    const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

    expect(ledgerStore.size).toBe(2);
    expect(feeStore.size).toBe(2);
    expect(refundStore.size).toBe(1);
    expect(snapshot.revenue).toMatchObject({ feeAmount: 425, refundAmount: 1000 });
    expect(snapshot.margin.grossProfitAmount).toBe(1575);
  });

  test('does not persist source rows or alter a snapshot for a dry-run import', async () => {
    await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: true }, writeAuth);

    expect(ledgerStore.size).toBe(0);
    expect(snapshotRepository.upsertByOrderItem).not.toHaveBeenCalled();

    const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

    expect(feeStore.size).toBe(0);
    expect(refundStore.size).toBe(0);
    expect(snapshot.revenue).toMatchObject({ feeAmount: 999, refundAmount: 888 });
  });

  test('does not include unlinked imported rows in a linked item snapshot', async () => {
    orderPublic.findItemByFinanceIdentity.mockResolvedValue(null);
    await financeImportService.importTransactions(transactionCsv, { ...context, dryRun: false }, writeAuth);

    expect([...ledgerStore.values()].every((row) => !Object.prototype.hasOwnProperty.call(row, 'orderItemId'))).toBe(true);
    expect([...feeStore.values()].every((row) => !Object.prototype.hasOwnProperty.call(row, 'orderItemId'))).toBe(true);
    expect([...refundStore.values()].every((row) => !Object.prototype.hasOwnProperty.call(row, 'orderItemId'))).toBe(true);

    const snapshot = await financeSnapshotService.recalculateOrderItem(orderItemId, writeAuth);

    expect(snapshot.revenue).toMatchObject({ feeAmount: 999, refundAmount: 888 });
    expect(snapshot.margin.grossProfitAmount).toBe(1113);
  });
});
