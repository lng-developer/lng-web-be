const fs = require('fs');
const os = require('os');
const path = require('path');

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
}));

jest.mock('../../modules/hr/public', () => ({
  getEmployeeProfileByEmployeeCode: jest.fn(),
}));

jest.mock('../../modules/organization/public', () => ({
  listAccountOrganizationSummaries: jest.fn(),
}));

jest.mock('../../modules/finance/repositories/financeSnapshot.repository', () => ({
  upsertByOrderItem: jest.fn(),
}));

jest.mock('../../modules/finance/repositories/financeImport.repository', () => ({
  completeImportBatch: jest.fn(),
  createImportBatch: jest.fn(),
  findImportBatchById: jest.fn(),
  listImportBatches: jest.fn(),
  sumFeesByOrderItem: jest.fn(),
  sumRefundsByOrderItem: jest.fn(),
  upsertAdsSpend: jest.fn(),
  upsertFeeLine: jest.fn(),
  upsertLedgerLine: jest.fn(),
  upsertRefundRecord: jest.fn(),
  upsertSettlement: jest.fn(),
}));

jest.mock('../../modules/media/public', () => ({
  storeAsset: jest.fn(),
  withAssetLocalReadFile: jest.fn(),
}));

const orderPublic = require('../../modules/order/public');
const mappingPublic = require('../../modules/mapping/public');
const shipmentPublic = require('../../modules/shipment/public');
const authPublic = require('../../modules/auth/public');
const hrPublic = require('../../modules/hr/public');
const snapshotRepository = require('../../modules/finance/repositories/financeSnapshot.repository');
const financeImportRepository = require('../../modules/finance/repositories/financeImport.repository');
const mediaPublic = require('../../modules/media/public');
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
let importBatches;
let assetFiles;
let nextAssetId;
let nextBatchId;

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
  importBatches = new Map();
  assetFiles = new Map();
  nextAssetId = 20;
  nextBatchId = 30;

  orderPublic.findItemByFinanceIdentity.mockResolvedValue(item);
  orderPublic.findItemById.mockResolvedValue(item);
  mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
    id: planId,
    costEstimate: { totalAmount: 2000, lines: [{ code: 'BASE_COST', amount: 2000 }] },
  });
  shipmentPublic.getShipmentByOrderItem.mockResolvedValue(null);
  hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValue(null);

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
  financeImportRepository.upsertAdsSpend.mockResolvedValue(undefined);
  financeImportRepository.createImportBatch.mockImplementation(async (payload) => {
    const _id = `6600000000000000001400${nextBatchId++}`;
    const batch = { _id, ...payload };
    importBatches.set(_id, batch);
    return batch;
  });
  financeImportRepository.completeImportBatch.mockImplementation(async (batchId, summary) => {
    const batch = importBatches.get(String(batchId));
    Object.assign(batch, summary, { finishedAt: new Date() });
    return batch;
  });
  financeImportRepository.findImportBatchById.mockImplementation(async (batchId) => importBatches.get(String(batchId)) || null);
  financeImportRepository.listImportBatches.mockImplementation(async () => ({
    items: [...importBatches.values()], total: importBatches.size, page: 1, limit: 20,
  }));
  mediaPublic.storeAsset.mockImplementation(async ({ stream }) => {
    const _id = `6600000000000000001400${nextAssetId++}`;
    assetFiles.set(_id, stream.path);
    stream.destroy();
    return { _id };
  });
  mediaPublic.withAssetLocalReadFile.mockImplementation(async (assetId, callback) => callback({
    localPath: assetFiles.get(String(assetId)),
  }));
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

  test('imports each supplied source into completed batches and retries a failed batch as a new batch', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-e2e-'));
    const files = {
      ADS: path.join(directory, 'ads.csv'),
      SETTLEMENTS: path.join(directory, 'settlements.txt'),
      TRANSACTIONS: path.join(directory, 'transactions.csv'),
    };
    fs.writeFileSync(files.ADS, [
      'Date,Campaign Name,Currency,Budget Amount,Impressions,Clicks,Spend,7 Day Total Orders (#),7 Day Total Sales ',
      '"Apr 15, 2026",J2522-AT,USD,$50.0,278,12,$3.93,0,$9.99',
    ].join('\n'));
    fs.writeFileSync(files.SETTLEMENTS, [
      'settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\ttotal-amount\tcurrency\ttransaction-type\torder-id\tamount-type\tamount-description\tamount\tsku\torder-item-code',
      '263\t2026-04-17 02:37:57 UTC\t2026-05-01 02:37:58 UTC\t2026-05-03 02:37:58 UTC\t-12988.06\tUSD\t\t\t\t\t\t\t',
      '263\t\t\t\t\t\tOrder\t114-1\tItemPrice\tPrincipal\t51.80\tSKU-1\t158',
    ].join('\n'));
    fs.writeFileSync(files.TRANSACTIONS, transactionCsv);

    try {
      const auth = { accountId: '660000000000000000140012', permissions: ['FINANCE:WRITE'] };
      await financeImportService.importAdsFromFile(files.ADS, { ...context, sourceRef: 'ads.csv', dryRun: false }, auth);
      await financeImportService.importSettlementsFromFile(files.SETTLEMENTS, { ...context, sourceRef: 'settlements.txt', dryRun: false }, auth);
      await financeImportService.importTransactionsFromFile(files.TRANSACTIONS, { ...context, dryRun: false }, auth);

      const completed = await financeImportService.listImportBatches({}, auth);
      expect(completed.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceType: 'ADS', status: 'COMPLETED' }),
        expect.objectContaining({ sourceType: 'SETTLEMENTS', status: 'COMPLETED' }),
        expect.objectContaining({ sourceType: 'TRANSACTIONS', status: 'COMPLETED' }),
      ]));

      financeImportRepository.upsertAdsSpend.mockRejectedValueOnce(new Error('fixture write failed'));
      const failed = await financeImportService.importAdsFromFile(files.ADS, { ...context, sourceRef: 'failed-ads.csv', dryRun: false }, auth);
      const retry = await financeImportService.retryImportBatch(failed.importBatchId, auth);

      expect(failed).toMatchObject({ status: 'FAILED' });
      expect(retry).toMatchObject({ status: 'COMPLETED' });
      expect(retry.importBatchId).not.toBe(failed.importBatchId);
      expect((await financeImportService.listImportBatches({}, auth)).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: failed.importBatchId, status: 'FAILED' }),
        expect.objectContaining({ id: retry.importBatchId, status: 'COMPLETED' }),
      ]));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
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
