const AdsSpendDaily = require('../../../src/modules/finance/models/adsSpendDaily.model');
const AdsUnassignedRow = require('../../../src/modules/finance/models/adsUnassignedRow.model');
const FinanceImportBatch = require('../../../src/modules/finance/models/financeImportBatch.model');
const MarketplaceFeeLine = require('../../../src/modules/finance/models/marketplaceFeeLine.model');
const MarketplaceSettlement = require('../../../src/modules/finance/models/marketplaceSettlement.model');
const MarketplaceSettlementLedgerLine = require('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model');
const FinanceSnapshot = require('../../../src/modules/finance/models/financeSnapshot.model');
const RefundRecord = require('../../../src/modules/finance/models/refundRecord.model');

describe('finance source models', () => {
  const shopId = '660000000000000000000201';

  test('ads spend has import identity by shop/channel/marketplace/date/campaign', () => {
    const uniqueIndexes = AdsSpendDaily.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => fields);

    expect(uniqueIndexes).toContainEqual({
      shopId: 1,
      salesChannelCode: 1,
      marketplaceCode: 1,
      reportDate: 1,
      campaignName: 1,
    });
  });

  test('ads spend persists seller attribution defaults', () => {
    const adsSpend = new AdsSpendDaily();

    expect(adsSpend.sellerEmployeeCode).toBeNull();
    expect(adsSpend.sellerAttributionSource).toBe('UNASSIGNED');
    expect(AdsSpendDaily.schema.path('sellerAttributionSource').enumValues)
      .toEqual(['PORTFOLIO_NAME', 'CAMPAIGN_NAME', 'UNASSIGNED']);
    expect(AdsSpendDaily.schema.indexes().map(([fields]) => fields))
      .toContainEqual({ sellerEmployeeCode: 1 });
  });

  test('settlement is unique by shop/channel/marketplace/settlementId', () => {
    const uniqueIndexes = MarketplaceSettlement.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => fields);

    expect(uniqueIndexes).toContainEqual({
      shopId: 1,
      salesChannelCode: 1,
      marketplaceCode: 1,
      settlementId: 1,
    });
  });

  test('ledger, fee, and refund models index order item lookups', () => {
    expect(MarketplaceSettlementLedgerLine.schema.indexes().map(([fields]) => fields))
      .toContainEqual({ orderItemId: 1, postedAt: -1 });
    expect(MarketplaceFeeLine.schema.indexes().map(([fields]) => fields))
      .toContainEqual({ orderItemId: 1, feeType: 1 });
    expect(RefundRecord.schema.indexes().map(([fields]) => fields))
      .toContainEqual({ orderItemId: 1, refundedAt: -1 });
  });

  test('finance snapshot indexes seller and team report dimensions', () => {
    const indexes = FinanceSnapshot.schema.indexes().map(([fields]) => fields);

    expect(indexes).toContainEqual({ sellerEmployeeCode: 1, calculatedAt: -1 });
    expect(indexes).toContainEqual({ teamId: 1, calculatedAt: -1 });
  });

  test('money fields require integer minor units', async () => {
    const fee = new MarketplaceFeeLine({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      feeType: 'SELLING_FEE',
      feeAmount: 12.34,
    });

    await expect(fee.validate()).rejects.toThrow('feeAmount must be an integer minor unit value');
  });

  test('refund total rejects negative values', async () => {
    const refund = new RefundRecord({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      refundedAt: new Date(),
      totalRefundAmount: -1,
    });

    await expect(refund.validate()).rejects.toThrow();
  });

  test('source records link back to a nullable import batch', () => {
    [
      AdsSpendDaily,
      MarketplaceSettlement,
      MarketplaceSettlementLedgerLine,
      MarketplaceFeeLine,
      RefundRecord,
    ].forEach((model) => {
      expect(model.schema.path('importBatchId').options.ref).toBe('FinanceImportBatch');
      expect(model.schema.path('importBatchId').options.default).toBeNull();
    });
  });

  test('import batch records source asset, scope, importer, and lifecycle state', async () => {
    const batch = new FinanceImportBatch({
      sourceType: 'TRANSACTIONS',
      sourceAssetId: '660000000000000000000202',
      originalFilename: 'transactions.csv',
      sourceRef: 'transactions.csv',
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      importedBy: '660000000000000000000203',
      status: 'PROCESSING',
    });

    await expect(batch.validate()).resolves.toBeUndefined();
    expect(FinanceImportBatch.schema.path('status').enumValues)
      .toEqual(['PROCESSING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED']);
  });

  test('indexes import batch and unassigned ads list filters with their sort order', () => {
    expect(FinanceImportBatch.schema.indexes().map(([fields]) => fields)).toContainEqual({
      sourceType: 1,
      salesChannelCode: 1,
      marketplaceCode: 1,
      createdAt: -1,
      _id: -1,
    });
    expect(AdsUnassignedRow.schema.indexes().map(([fields]) => fields)).toContainEqual({
      status: 1,
      reportDate: -1,
      createdAt: -1,
    });
  });
});
