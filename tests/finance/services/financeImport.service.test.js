const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../src/modules/order/public', () => ({
  findOrderByFinanceIdentity: jest.fn(),
  findItemByFinanceIdentity: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../src/modules/finance/repositories/financeImport.repository', () => ({
  completeImportBatch: jest.fn(),
  createImportBatch: jest.fn(),
  initializeImportBatchRecalculation: jest.fn(),
  findCompletedImportBatchBySourceRef: jest.fn(),
  findImportBatchByContentHash: jest.fn(),
  findImportBatchById: jest.fn(),
  listImportBatches: jest.fn(),
  listImportedData: jest.fn(),
  linkLedgerRowToOrder: jest.fn(),
  listUnlinkedLedgerRows: jest.fn(),
  linkLedgerRowToOrderItem: jest.fn(),
  upsertAdsSpend: jest.fn(),
  upsertFeeLine: jest.fn(),
  upsertLedgerLine: jest.fn(),
  upsertRefundRecord: jest.fn(),
  upsertSettlement: jest.fn(),
}));

jest.mock('../../../src/modules/finance/services/financeSnapshotQueue.service', () => ({
  enqueueSnapshotRecalculation: jest.fn(),
}));

jest.mock('../../../src/modules/media/public', () => ({
  discardUnattachedAsset: jest.fn(),
  storeAsset: jest.fn(),
  withAssetLocalReadFile: jest.fn(),
}));

jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn(),
}));

jest.mock('../../../src/modules/finance/services/adsShopMapping.service', () => ({
  normalizeExternalId: jest.fn((value) => value),
  resolveShopForAdsRow: jest.fn(),
}));

jest.mock('../../../src/modules/finance/repositories/adsUnassignedRow.repository', () => ({
  list: jest.fn(),
  markResolved: jest.fn(),
  upsertPending: jest.fn(),
}));

jest.mock('../../../src/shared/utils/logger', () => ({
  warn: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const orderPublic = require('../../../src/modules/order/public');
const repository = require('../../../src/modules/finance/repositories/financeImport.repository');
const mediaPublic = require('../../../src/modules/media/public');
const auditPublic = require('../../../src/modules/audit/public');
const logger = require('../../../src/shared/utils/logger');
const adsShopMappingService = require('../../../src/modules/finance/services/adsShopMapping.service');
const adsUnassignedRowRepository = require('../../../src/modules/finance/repositories/adsUnassignedRow.repository');
const { enqueueSnapshotRecalculation } = require('../../../src/modules/finance/services/financeSnapshotQueue.service');
const service = require('../../../src/modules/finance/services/financeImport.service');

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
    repository.initializeImportBatchRecalculation.mockResolvedValue({});
    enqueueSnapshotRecalculation.mockResolvedValue({ queued: true });
    adsShopMappingService.normalizeExternalId.mockImplementation((value) => value);
    adsShopMappingService.resolveShopForAdsRow.mockResolvedValue({ shopId, matchedBy: 'CAMPAIGN' });
    adsUnassignedRowRepository.upsertPending.mockResolvedValue({});
    adsUnassignedRowRepository.markResolved.mockResolvedValue({});
  });

  test('does not audit routine finance-import reads', async () => {
    const batchId = '660000000000000000140011';
    const auth = {
      accountId: '660000000000000000140099',
      permissions: ['FINANCE:READ'],
      auditContext: { requestId: 'finance-import-read' },
    };
    repository.listImportBatches.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    repository.findImportBatchById.mockResolvedValue({ _id: batchId, shopId, sourceType: 'TRANSACTIONS' });
    repository.listImportedData.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });

    await service.listImportBatches({ page: 1, limit: 20 }, auth);
    await service.getImportBatch(batchId, auth);
    await service.listImportedData('TRANSACTIONS', { page: 1, limit: 20 }, auth);

    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('checks completed Ads imports by their source reference', async () => {
    repository.findCompletedImportBatchBySourceRef.mockResolvedValue({ _id: '660000000000000000140011' });

    await expect(service.hasCompletedAdsImportSource('gmail:<amazon-report@example>', { system: true }))
      .resolves.toBe(true);
    expect(repository.findCompletedImportBatchBySourceRef).toHaveBeenCalledWith('ADS', 'gmail:<amazon-report@example>');
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

  test('reconciles only uniquely resolved unlinked ledger rows', async () => {
    repository.listUnlinkedLedgerRows.mockResolvedValue([
      {
        _id: '660000000000000000140101',
        shopId,
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        externalOrderId: '114-1',
        externalItemId: 'ITEM-1',
        sku: 'SKU-1',
      },
      {
        _id: '660000000000000000140102',
        shopId,
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        externalOrderId: '114-2',
        sku: 'SKU-2',
      },
    ]);
    orderPublic.findItemByFinanceIdentity
      .mockResolvedValueOnce({ _id: orderItemId, orderId, listingId: '660000000000000000140004' })
      .mockResolvedValueOnce(null);
    repository.linkLedgerRowToOrderItem.mockResolvedValue({ linked: true });

    await expect(service.reconcileUnlinkedLedgerRows({
      dateFrom: new Date('2026-08-15T00:00:00.000Z'),
      dateTo: new Date('2026-09-17T23:59:59.999Z'),
      ledgerCategory: 'TRANSACTION',
      dryRun: false,
    })).resolves.toEqual({ checked: 2, linked: 1, unresolved: 1, dryRun: false });

    expect(repository.linkLedgerRowToOrderItem).toHaveBeenCalledWith({
      ledgerLineId: '660000000000000000140101',
      orderId,
      orderItemId,
      listingId: '660000000000000000140004',
    });
    expect(repository.listUnlinkedLedgerRows).toHaveBeenCalledWith(expect.objectContaining({
      ledgerCategory: 'TRANSACTION',
    }));
  });

  test('links order-only ledger rows without assigning an order item', async () => {
    repository.listUnlinkedLedgerRows.mockResolvedValue([{
      _id: '660000000000000000140103',
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '114-3',
    }]);
    orderPublic.findOrderByFinanceIdentity.mockResolvedValue({ _id: orderId });
    repository.linkLedgerRowToOrder.mockResolvedValue({ linked: true });

    await expect(service.reconcileUnlinkedLedgerRows({ dryRun: false }))
      .resolves.toEqual({ checked: 1, linked: 1, unresolved: 0, dryRun: false });

    expect(repository.linkLedgerRowToOrder).toHaveBeenCalledWith({
      ledgerLineId: '660000000000000000140103',
      orderId,
    });
    expect(repository.linkLedgerRowToOrderItem).not.toHaveBeenCalled();
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
    expect(enqueueSnapshotRecalculation).not.toHaveBeenCalled();
  });

  test('reuses a completed batch for the same source file content', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-duplicate-'));
    const filePath = path.join(directory, 'ads.csv');
    fs.writeFileSync(filePath, [
      'Date,Campaign Name,Spend',
      '2026-04-15,J2522-AT,3.93',
    ].join('\n'));
    repository.findImportBatchByContentHash.mockResolvedValue({
      _id: '660000000000000000140099',
      sourceType: 'ADS',
      sourceRef: 'ads.csv',
      dryRun: false,
      status: 'COMPLETED',
      processedRows: 1,
      validRows: 1,
      skippedRows: 0,
      unlinkedRows: 0,
      upserted: { adsRows: 1 },
      errors: [],
    });

    try {
      const result = await service.importAdsFromFile(filePath, { ...context, sourceRef: 'ads.csv', dryRun: false }, {
        permissions: ['FINANCE:WRITE'],
      });

      expect(repository.findImportBatchByContentHash).toHaveBeenCalledWith(expect.objectContaining({
        shopId,
        sourceType: 'ADS',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }));
      expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
      expect(repository.createImportBatch).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        importBatchId: '660000000000000000140099',
        status: 'COMPLETED',
        duplicate: true,
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
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

  test('routes scheduled Ads CSV rows only to explicitly mapped shops', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mapped-ads-import-'));
    const filePath = path.join(directory, 'ads.csv');
    fs.writeFileSync(filePath, [
      'Date range,Advertiser account ID,Campaign ID,Campaign name,Portfolio ID,Total cost',
      '"Aug 24, 2026 - Aug 24, 2026",account-1,campaign-1,Campaign 1,portfolio-1,4.25',
      '"Aug 24, 2026 - Aug 24, 2026",account-1,campaign-2,Campaign 2,portfolio-2,6.00',
    ].join('\n'));
    adsShopMappingService.resolveShopForAdsRow
      .mockResolvedValueOnce({ shopId, matchedBy: 'CAMPAIGN' })
      .mockResolvedValueOnce({ shopId: null, matchedBy: 'UNASSIGNED' });

    try {
      const result = await service.importMappedAdsFromFile(
        { path: filePath, originalname: 'ads.csv', mimetype: 'text/csv' },
        { salesChannelCode: 'AMAZON', marketplaceCode: 'US', sourceRef: 'gmail:message-1' },
        { system: true },
      );

      expect(result).toMatchObject({ importedShops: 1, unassignedRows: 1, complete: false });
      expect(adsUnassignedRowRepository.upsertPending).toHaveBeenCalledWith(expect.objectContaining({
        sourceRef: 'gmail:message-1', campaignId: 'campaign-2',
      }));
      expect(repository.upsertAdsSpend).toHaveBeenCalledTimes(1);
      expect(repository.upsertAdsSpend).toHaveBeenCalledWith(expect.objectContaining({ shopId, campaignId: 'campaign-1' }));
      expect(repository.createImportBatch).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: `gmail:message-1:${shopId}` }));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('ads import accepts shop-scoped FINANCE:WRITE for the matching shop', async () => {
    const result = await service.importAds([
      'Date,Campaign Name,Spend',
      '2026-04-15,J2522-AT,3.93',
    ].join('\n'), { ...context, sourceRef: 'ads.csv', dryRun: false }, {
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['FINANCE:WRITE'] }],
    });

    expect(repository.upsertAdsSpend).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      campaignName: 'J2522-AT',
      spendAmount: 393,
    }));
    expect(result.upserted.adsRows).toBe(1);
  });

  test('ads import uses the extension token shop without a submitted shop', async () => {
    const { shopId: _submittedShopId, ...extensionContext } = context;
    await service.importAds([
      'Date,Campaign Name,Spend',
      '2026-04-15,J2522-AT,3.93',
    ].join('\n'), { ...extensionContext, sourceRef: 'ads.csv', dryRun: false }, {
      tokenType: 'EXTENSION',
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['FINANCE:WRITE'] }],
    });

    expect(repository.upsertAdsSpend).toHaveBeenCalledWith(expect.objectContaining({ shopId }));
  });

  test('ads import rejects shop-scoped FINANCE:WRITE for another shop', async () => {
    await expect(service.importAds([
      'Date,Campaign Name,Spend',
      '2026-04-15,J2522-AT,3.93',
    ].join('\n'), { ...context, sourceRef: 'ads.csv', dryRun: false }, {
      scopes: [{
        scopeType: 'shop',
        scopeId: '660000000000000000149999',
        permissions: ['FINANCE:WRITE'],
      }],
    })).rejects.toThrow('Forbidden');
  });

  test('transaction import accepts shop-scoped FINANCE:WRITE for the matching shop', async () => {
    const result = await service.importTransactions([
      '"date/time","settlement id","type","order id","sku","selling fees","other transaction fees","total"',
      '"2026-08-12T00:00:00Z","262","Order","114-1","SKU-1","-3.25","-1.00","12.34"',
    ].join('\n'), { ...context, sourceRef: 'transactions.csv', dryRun: false }, {
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['FINANCE:WRITE'] }],
    });

    expect(repository.upsertLedgerLine).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      externalOrderId: '114-1',
      sku: 'SKU-1',
    }));
    expect(result.processedRows).toBe(1);
  });

  test('transaction import rejects shop-scoped FINANCE:WRITE for another shop', async () => {
    await expect(service.importTransactions([
      '"date/time","settlement id","type","order id","sku","selling fees","other transaction fees","total"',
      '"2026-08-12T00:00:00Z","262","Order","114-1","SKU-1","-3.25","-1.00","12.34"',
    ].join('\n'), { ...context, sourceRef: 'transactions.csv', dryRun: false }, {
      scopes: [{
        scopeType: 'shop',
        scopeId: '660000000000000000149999',
        permissions: ['FINANCE:WRITE'],
      }],
    })).rejects.toThrow('Forbidden');
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
      expect(repository.initializeImportBatchRecalculation).toHaveBeenCalledWith(
        '660000000000000000140011', 1,
      );
      expect(enqueueSnapshotRecalculation).toHaveBeenCalledWith({
        orderItemId,
        reason: 'FINANCE_IMPORT',
        importBatchId: '660000000000000000140011',
      });
      expect(result).toMatchObject({
        importBatchId: '660000000000000000140011',
        status: 'COMPLETED',
      });
      expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
        actorType: 'ACCOUNT',
        actorAccountId: '660000000000000000140012',
        action: 'FINANCE_TRANSACTIONS_IMPORTED',
        entityType: 'FINANCE_IMPORT_BATCH',
        entityId: '660000000000000000140011',
        scopeType: 'SHOP',
        scopeId: shopId,
        outcome: 'SUCCEEDED',
        source: 'IMPORT',
        metadata: {
          sourceType: 'TRANSACTIONS',
          preview: false,
          processedRows: 1,
          acceptedRows: 1,
          rejectedRows: 0,
          unlinkedRows: 0,
        },
        deduplicationKey: 'finance-import:660000000000000000140011:completed',
      }), {});
      expect(JSON.stringify(auditPublic.record.mock.calls[0])).not.toMatch(/raw|fileBytes|settlementId|totalAmount/i);
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
      expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'FINANCE_IMPORT_REPROCESSED',
        entityId: '660000000000000000140014',
        metadata: expect.objectContaining({
          sourceType: 'TRANSACTIONS',
          sourceImportBatchId: '660000000000000000140013',
        }),
        deduplicationKey: 'finance-import:660000000000000000140014:completed',
      }), {});
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('dry-run import is audited as an explicit preview', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-preview-'));
    const filePath = path.join(directory, 'ads.csv');
    fs.writeFileSync(filePath, [
      'Date,Campaign Name,Currency,Spend',
      '"Apr 15, 2026",J2522-AT,USD,$3.93',
    ].join('\n'));

    try {
      await service.importAdsFromFile(filePath, { ...context, dryRun: true }, {
        accountId: '660000000000000000140012', permissions: ['FINANCE:WRITE'],
      });

      expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'FINANCE_ADS_IMPORTED',
        outcome: 'SUCCEEDED',
        metadata: expect.objectContaining({ preview: true, acceptedRows: 1, rejectedRows: 0 }),
      }), {});
      expect(repository.upsertAdsSpend).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('mixed Ads import reports every valid row as accepted and structural skips as rejected', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-mixed-'));
    const filePath = path.join(directory, 'ads.csv');
    fs.writeFileSync(filePath, [
      'Date,Campaign Name,Currency,Spend',
      '"Apr 15, 2026",J2522-AT,USD,$3.93',
      '"Apr 16, 2026",,USD,$1.00',
    ].join('\n'));

    try {
      await service.importAdsFromFile(filePath, { ...context, dryRun: false }, {
        accountId: '660000000000000000140012', permissions: ['FINANCE:WRITE'],
      });

      expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ processedRows: 2, acceptedRows: 1, rejectedRows: 1 }),
      }), {});
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('completed import still succeeds when audit storage is unavailable', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-audit-outage-'));
    const filePath = path.join(directory, 'ads.csv');
    fs.writeFileSync(filePath, [
      'Date,Campaign Name,Currency,Spend',
      '"Apr 15, 2026",J2522-AT,USD,$3.93',
    ].join('\n'));
    auditPublic.record.mockRejectedValueOnce(new Error('audit database unavailable'));

    try {
      await expect(service.importAdsFromFile(filePath, { ...context, dryRun: false }, {
        accountId: '660000000000000000140012', permissions: ['FINANCE:WRITE'],
      }, { requestId: 'req-import-outage' })).resolves.toMatchObject({ status: 'COMPLETED' });

      expect(logger.warn).toHaveBeenCalledWith('finance_import_audit_failed', {
        importBatchId: '660000000000000000140011',
        requestId: 'req-import-outage',
        sourceType: 'ADS',
        status: 'COMPLETED',
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('failed row import records a failed event with counts but no raw finance data', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-failed-'));
    const filePath = path.join(directory, 'settlements.txt');
    fs.writeFileSync(filePath, [
      'settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\ttotal-amount\tcurrency',
      '263\t2026-04-17 02:37:57 UTC\t2026-05-01 02:37:58 UTC\t2026-05-03 02:37:58 UTC\t-12988.06\tUSD',
    ].join('\n'));
    repository.upsertSettlement.mockRejectedValueOnce(new Error('write failed'));

    try {
      await expect(service.importSettlementsFromFile(filePath, {
        ...context, sourceRef: 'settlements.txt', dryRun: false,
      }, {
        accountId: '660000000000000000140012', permissions: ['FINANCE:WRITE'],
      })).resolves.toMatchObject({ status: 'FAILED', skippedRows: 1 });

      expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'FINANCE_SETTLEMENTS_IMPORTED',
        outcome: 'FAILED',
        metadata: expect.objectContaining({ processedRows: 1, acceptedRows: 0, rejectedRows: 1 }),
      }), {});
      expect(JSON.stringify(auditPublic.record.mock.calls[0])).not.toContain('-12988.06');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('read failure records a failed import event and preserves the original error', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-read-failed-'));
    const filePath = path.join(directory, 'transactions.csv');
    fs.writeFileSync(filePath, 'unused');
    const readError = new Error('cannot read source asset');
    const readSpy = jest.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(readError);
    mediaPublic.storeAsset.mockImplementationOnce(({ stream }) => new Promise((resolve, reject) => {
      stream.once('error', reject);
      stream.once('open', () => {
        stream.destroy();
        resolve({ _id: '660000000000000000140010' });
      });
    }));

    try {
      await expect(service.importTransactionsFromFile(filePath, {
        ...context, dryRun: false,
      }, {
        accountId: '660000000000000000140012', permissions: ['FINANCE:WRITE'],
      })).rejects.toBe(readError);

      expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'FINANCE_TRANSACTIONS_IMPORTED',
        outcome: 'FAILED',
        metadata: expect.objectContaining({ processedRows: 0, acceptedRows: 0, rejectedRows: 0 }),
      }), {});
    } finally {
      readSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('import history requires global finance access while shop scope can import its shop', async () => {
    const scopedAuth = {
      permissions: [],
      scopes: [{
        scopeType: 'shop',
        scopeId: shopId,
        permissions: ['FINANCE:WRITE'],
      }],
    };
    await expect(service.listImportBatches({}, scopedAuth))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    await expect(service.listImportedData('ads', {}, scopedAuth))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

    const result = await service.importTransactions('"date/time"\n', context, scopedAuth);

    expect(repository.listImportBatches).not.toHaveBeenCalled();
    expect(repository.listImportedData).not.toHaveBeenCalled();
    expect(result).toMatchObject({ processedRows: 1, validRows: 0, skippedRows: 1 });
  });

  test('extension token can read its own shop import batch but not another shop batch', async () => {
    const batchId = '660000000000000000140011';
    const extensionAuth = {
      tokenType: 'EXTENSION',
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['FINANCE:WRITE'] }],
    };
    repository.findImportBatchById.mockResolvedValue({ _id: batchId, shopId, sourceType: 'TRANSACTIONS' });

    await expect(service.getImportBatch(batchId, extensionAuth))
      .resolves.toMatchObject({ id: batchId, shopId, sourceType: 'TRANSACTIONS' });

    repository.findImportBatchById.mockResolvedValue({
      _id: batchId,
      shopId: '660000000000000000149999',
      sourceType: 'TRANSACTIONS',
    });

    await expect(service.getImportBatch(batchId, extensionAuth)).rejects.toThrow('Forbidden');
  });

  test('global finance write can read import history without a shop rewrite', async () => {
    repository.listImportBatches.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });

    await service.listImportBatches({ status: 'FAILED' }, { permissions: ['FINANCE:WRITE'] });

    expect(repository.listImportBatches).toHaveBeenCalledWith({ status: 'FAILED' });
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
