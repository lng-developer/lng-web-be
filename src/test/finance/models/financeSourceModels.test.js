const AdsSpendDaily = require('../../../modules/finance/models/adsSpendDaily.model');
const MarketplaceFeeLine = require('../../../modules/finance/models/marketplaceFeeLine.model');
const MarketplaceSettlement = require('../../../modules/finance/models/marketplaceSettlement.model');
const MarketplaceSettlementLedgerLine = require('../../../modules/finance/models/marketplaceSettlementLedgerLine.model');
const FinanceSnapshot = require('../../../modules/finance/models/financeSnapshot.model');
const RefundRecord = require('../../../modules/finance/models/refundRecord.model');

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
});
