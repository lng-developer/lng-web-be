jest.mock('../../../modules/order/public', () => ({
  findItemByFinanceIdentity: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/finance/repositories/financeImport.repository', () => ({
  upsertAdsSpend: jest.fn(),
  upsertFeeLine: jest.fn(),
  upsertLedgerLine: jest.fn(),
  upsertRefundRecord: jest.fn(),
  upsertSettlement: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const orderPublic = require('../../../modules/order/public');
const repository = require('../../../modules/finance/repositories/financeImport.repository');
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
});
