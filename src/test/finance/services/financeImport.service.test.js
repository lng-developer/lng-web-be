const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../modules/order/public', () => ({
  findItemByFinanceIdentity: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/finance/repositories/financeImport.repository', () => ({
  completeImportBatch: jest.fn(),
  createImportBatch: jest.fn(),
  findImportBatchById: jest.fn(),
  upsertAdsSpend: jest.fn(),
  upsertFeeLine: jest.fn(),
  upsertLedgerLine: jest.fn(),
  upsertRefundRecord: jest.fn(),
  upsertSettlement: jest.fn(),
}));

jest.mock('../../../modules/media/public', () => ({
  discardUnattachedAsset: jest.fn(),
  storeAsset: jest.fn(),
  withAssetLocalReadFile: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const orderPublic = require('../../../modules/order/public');
const repository = require('../../../modules/finance/repositories/financeImport.repository');
const mediaPublic = require('../../../modules/media/public');
const service = require('../../../modules/finance/services/financeImport.service');

describe('financeImport.service', () => {
  const shopId = '660000000000000000140003';
  const orderId = '660000000000000000140001';
  const orderItemId = '660000000000000000140002';
  const context = {
    shopId,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    sourceRef: 'transaction.csv',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    orderPublic.findItemByFinanceIdentity.mockResolvedValue({ _id: orderItemId, orderId });
    mediaPublic.storeAsset.mockResolvedValue({ _id: '660000000000000000140010' });
    repository.createImportBatch.mockResolvedValue({ _id: '660000000000000000140011' });
    repository.completeImportBatch.mockResolvedValue({ _id: '660000000000000000140011' });
  });

  test('transaction dry-run parses and links rows without writes', async () => {
    const result = await service.importTransactions([
      '"date/time","settlement id","type","order id","sku","selling fees","other transaction fees","total"',
      '"Apr 15, 2026 3:48:00 AM PDT","262","Order","114-1","SKU-1","-3.25","-1.00","48.03"',
    ].join('\n'), { ...context, dryRun: true }, { permissions: ['FINANCE:WRITE'] });

    expect(orderPublic.findItemByFinanceIdentity).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      externalOrderId: '114-1',
      sku: 'SKU-1',
    }));
    expect(repository.upsertLedgerLine).not.toHaveBeenCalled();
    expect(repository.upsertFeeLine).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      dryRun: true,
      processedRows: 1,
      validRows: 1,
      upserted: { ledgerLines: 0, feeLines: 0, refundRecords: 0 },
      unlinkedRows: 0,
    });
  });

  test('transaction import writes ledger and positive fee lines', async () => {
    const result = await service.importTransactions([
      '"date/time","settlement id","type","order id","sku","selling fees","other transaction fees","total"',
      '"Apr 15, 2026 3:48:00 AM PDT","262","Order","114-1","SKU-1","-3.25","-1.00","48.03"',
    ].join('\n'), { ...context, dryRun: false }, { permissions: ['FINANCE:WRITE'] });

    expect(repository.upsertLedgerLine).toHaveBeenCalledTimes(1);
    expect(repository.upsertFeeLine).toHaveBeenCalledWith(expect.objectContaining({
      orderItemId,
      feeType: 'SELLING_FEES',
      feeAmount: 325,
      totalFeeAmount: 325,
    }));
    expect(repository.upsertFeeLine).toHaveBeenCalledWith(expect.objectContaining({
      feeType: 'OTHER_TRANSACTION_FEES',
      feeAmount: 100,
      totalFeeAmount: 100,
    }));
    expect(result.upserted.feeLines).toBe(2);
  });

  test('multi-line transaction header preserves order and SKU from file import', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-'));
    const filePath = path.join(directory, 'transaction.csv');
    fs.writeFileSync(filePath, [
      '"date/time","settlement\nid","type","order id","sku","selling fees","other transaction fees","total"',
      '"Apr 15, 2026 3:48:00 AM PDT","262","Order","114-5923330-5214637","J2528-NK-050126-609","-3.25","-1.00","48.03"',
    ].join('\n'));

    try {
      await service.importTransactionsFromFile(filePath, { ...context, dryRun: false }, { permissions: ['FINANCE:WRITE'] });

      expect(repository.upsertLedgerLine).toHaveBeenCalledWith(expect.objectContaining({
        externalOrderId: '114-5923330-5214637',
        sku: 'J2528-NK-050126-609',
      }));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('settlement import writes settlement header and ledger rows', async () => {
    const result = await service.importSettlements([
      'settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\ttotal-amount\tcurrency\ttransaction-type\torder-id\tamount-type\tamount-description\tamount\tsku\torder-item-code',
      '263\t2026-04-17 02:37:57 UTC\t2026-05-01 02:37:58 UTC\t2026-05-03 02:37:58 UTC\t-12988.06\tUSD\t\t\t\t\t\t\t',
      '263\t\t\t\t\t\tOrder\t113-1\tItemPrice\tPrincipal\t51.80\tSKU-1\t158',
    ].join('\n'), { ...context, sourceRef: 'settlement.txt', dryRun: false }, { permissions: ['FINANCE:WRITE'] });

    expect(repository.upsertSettlement).toHaveBeenCalledTimes(1);
    expect(repository.upsertLedgerLine).toHaveBeenCalledTimes(1);
    expect(result.upserted).toMatchObject({ settlements: 1, ledgerLines: 1 });
  });

  test('ads import writes daily campaign rows', async () => {
    const result = await service.importAds([
      'Date,Campaign Name,Currency,Budget Amount,Impressions,Clicks,Spend,7 Day Total Orders (#),7 Day Total Sales ',
      '"Apr 15, 2026",J2522-AT,USD,$50.0,278,12,$3.93,0,$9.99',
    ].join('\n'), { ...context, sourceRef: 'ads.csv', dryRun: false }, { permissions: ['FINANCE:WRITE'] });

    expect(repository.upsertAdsSpend).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      campaignName: 'J2522-AT',
      spendAmount: 393,
    }));
    expect(result.upserted.adsRows).toBe(1);
  });

  test('uploaded transaction imports create and complete a replayable batch', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-batch-'));
    const filePath = path.join(directory, 'transactions.csv');
    fs.writeFileSync(filePath, [
      '"date/time","settlement id","type","order id","sku","selling fees","other transaction fees","total"',
      '"Apr 15, 2026 3:48:00 AM PDT","262","Order","114-1","SKU-1","-3.25","-1.00","48.03"',
    ].join('\n'));

    try {
      const result = await service.importTransactionsFromFile({
        path: filePath,
        originalname: 'transactions.csv',
        mimetype: 'text/csv',
      }, { ...context, dryRun: false }, {
        accountId: '660000000000000000140012',
        permissions: ['FINANCE:WRITE'],
      });

      expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
        filename: 'transactions.csv',
        mimeType: 'text/csv',
      }));
      expect(repository.createImportBatch).toHaveBeenCalledWith(expect.objectContaining({
        sourceType: 'TRANSACTIONS',
        sourceAssetId: '660000000000000000140010',
        originalFilename: 'transactions.csv',
        shopId,
        status: 'PROCESSING',
        importedBy: '660000000000000000140012',
      }));
      expect(repository.upsertLedgerLine).toHaveBeenCalledWith(expect.objectContaining({
        importBatchId: '660000000000000000140011',
      }));
      expect(repository.completeImportBatch).toHaveBeenCalledWith(
        '660000000000000000140011',
        expect.objectContaining({ status: 'COMPLETED', processedRows: 1 }),
      );
      expect(result).toMatchObject({
        importBatchId: '660000000000000000140011',
        status: 'COMPLETED',
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('retry creates a new batch from the source asset without replacing the source batch', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-retry-'));
    const filePath = path.join(directory, 'transactions.csv');
    fs.writeFileSync(filePath, [
      '"date/time","settlement id","type","order id","sku","selling fees","other transaction fees","total"',
      '"Apr 15, 2026 3:48:00 AM PDT","262","Order","114-1","SKU-1","-3.25","-1.00","48.03"',
    ].join('\n'));
    repository.findImportBatchById.mockResolvedValue({
      _id: '660000000000000000140013',
      sourceType: 'TRANSACTIONS',
      sourceAssetId: '660000000000000000140010',
      originalFilename: 'transactions.csv',
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sourceRef: 'transactions.csv',
      dryRun: false,
    });
    repository.createImportBatch.mockResolvedValue({ _id: '660000000000000000140014' });
    repository.completeImportBatch.mockResolvedValue({ _id: '660000000000000000140014' });
    mediaPublic.withAssetLocalReadFile.mockImplementation(async (assetId, callback) => callback({
      localPath: filePath,
      mediaAsset: { _id: assetId },
    }));

    try {
      const result = await service.retryImportBatch(
        '660000000000000000140013',
        { accountId: '660000000000000000140012', permissions: ['FINANCE:WRITE'] },
      );

      expect(mediaPublic.withAssetLocalReadFile).toHaveBeenCalledWith(
        '660000000000000000140010',
        expect.any(Function),
      );
      expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
      expect(repository.createImportBatch).toHaveBeenCalledWith(expect.objectContaining({
        sourceAssetId: '660000000000000000140010',
        status: 'PROCESSING',
      }));
      expect(repository.completeImportBatch).toHaveBeenCalledWith(
        '660000000000000000140014',
        expect.objectContaining({ status: 'COMPLETED' }),
      );
      expect(result).toMatchObject({
        importBatchId: '660000000000000000140014',
        status: 'COMPLETED',
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('cleans up the stored asset when batch creation fails', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-cleanup-'));
    const filePath = path.join(directory, 'transactions.csv');
    fs.writeFileSync(filePath, '"date/time"\n');
    mediaPublic.storeAsset.mockImplementationOnce(({ stream }) => new Promise((resolve, reject) => {
      stream.once('error', reject);
      stream.once('open', () => {
        stream.destroy();
        resolve({ _id: '660000000000000000140010' });
      });
    }));
    repository.createImportBatch.mockRejectedValueOnce(new Error('database unavailable'));

    try {
      await expect(service.importTransactionsFromFile({
        path: filePath,
        originalname: 'transactions.csv',
        mimetype: 'text/csv',
      }, context, { permissions: ['FINANCE:WRITE'] })).rejects.toThrow('database unavailable');

      expect(mediaPublic.discardUnattachedAsset).toHaveBeenCalledWith(
        '660000000000000000140010',
        { source: 'FINANCE_IMPORT', sourceType: 'TRANSACTIONS' },
        'FINANCE_IMPORT_BATCH_CREATION_FAILED',
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
