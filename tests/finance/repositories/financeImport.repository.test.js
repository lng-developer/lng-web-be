jest.mock('../../../src/modules/finance/models/adsSpendDaily.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/financeImportBatch.model', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/marketplaceFeeLine.model', () => ({ find: jest.fn(), findOneAndUpdate: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/marketplaceSettlement.model', () => ({ find: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model', () => ({ find: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/refundRecord.model', () => ({ find: jest.fn(), findOneAndUpdate: jest.fn(), aggregate: jest.fn() }));

const FinanceImportBatch = require('../../../src/modules/finance/models/financeImportBatch.model');
const MarketplaceFeeLine = require('../../../src/modules/finance/models/marketplaceFeeLine.model');
const MarketplaceSettlement = require('../../../src/modules/finance/models/marketplaceSettlement.model');
const MarketplaceSettlementLedgerLine = require('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model');
const RefundRecord = require('../../../src/modules/finance/models/refundRecord.model');
const repository = require('../../../src/modules/finance/repositories/financeImport.repository');

function query() {
  return { lean: jest.fn().mockResolvedValue({}) };
}

describe('financeImport.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('replay keeps the original normalized source row unchanged', async () => {
    MarketplaceSettlementLedgerLine.findOneAndUpdate.mockReturnValue(query());

    await repository.upsertLedgerLine({
      shopId: '660000000000000000140003',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sourceRef: 'transactions.csv',
      importBatchId: '660000000000000000140011',
      rawReference: { importKey: 'transaction:2' },
      amount: 4803,
    });

    expect(MarketplaceSettlementLedgerLine.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: 'transactions.csv',
        'rawReference.importKey': 'transaction:2',
      }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          importBatchId: '660000000000000000140011',
          amount: 4803,
          sourceRef: 'transactions.csv',
        }),
      }),
      expect.any(Object),
    );
    expect(MarketplaceSettlementLedgerLine.findOneAndUpdate.mock.calls[0][1]).not.toHaveProperty('$set');
    expect(MarketplaceSettlementLedgerLine.findOneAndUpdate.mock.calls[0][2]).toMatchObject({
      timestamps: false,
    });
  });

  test('transaction rows use their dedup key and accept the later import payload', async () => {
    MarketplaceSettlementLedgerLine.findOneAndUpdate.mockReturnValue(query());
    MarketplaceFeeLine.findOneAndUpdate.mockReturnValue(query());
    RefundRecord.findOneAndUpdate.mockReturnValue(query());
    const base = {
      shopId: '660000000000000000140003',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sourceRef: 'transactions-2026-09-13-2026-09-14.csv',
      importBatchId: '660000000000000000140012',
    };

    await repository.upsertLedgerLine({
      ...base,
      ledgerCategory: 'TRANSACTION',
      rawReference: { importKey: 'transaction:2', dedupKey: 'txn-1' },
      amount: 5003,
    });
    await repository.upsertFeeLine({
      ...base,
      feeType: 'SELLING_FEES',
      rawReference: { importKey: 'transaction:2:SELLING_FEES', dedupKey: 'txn-1:SELLING_FEES' },
      totalFeeAmount: 400,
    });
    await repository.upsertRefundRecord({
      ...base,
      externalRefundId: 'txn-1:REFUND',
      rawReference: { importKey: 'transaction:3', dedupKey: 'txn-2' },
      totalRefundAmount: 1000,
    });

    expect(MarketplaceSettlementLedgerLine.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ 'rawReference.dedupKey': 'txn-1' }),
      expect.objectContaining({ $set: expect.objectContaining({ amount: 5003, sourceRef: base.sourceRef }) }),
      expect.any(Object),
    );
    expect(MarketplaceFeeLine.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ feeType: 'SELLING_FEES', 'rawReference.dedupKey': 'txn-1:SELLING_FEES' }),
      expect.objectContaining({ $set: expect.objectContaining({ totalFeeAmount: 400 }) }),
      expect.any(Object),
    );
    expect(RefundRecord.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalRefundId: 'txn-1:REFUND' }),
      expect.objectContaining({ $set: expect.objectContaining({ totalRefundAmount: 1000 }) }),
      expect.any(Object),
    );
  });

  test('settlement headers and activities accept the later import payload by stable identity', async () => {
    MarketplaceSettlement.findOneAndUpdate.mockReturnValue(query());
    MarketplaceSettlementLedgerLine.findOneAndUpdate.mockReturnValue(query());
    const base = {
      shopId: '660000000000000000140003',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sourceRef: 'settlements-263-corrected.txt',
      importBatchId: '660000000000000000140012',
    };

    await repository.upsertSettlement({ ...base, settlementId: '263', totalAmount: 5380 });
    await repository.upsertLedgerLine({
      ...base,
      ledgerCategory: 'SETTLEMENT_ACTIVITY',
      rawReference: { importKey: 'settlement:2', dedupKey: 'settlement-activity-1' },
      amount: 5380,
    });

    expect(MarketplaceSettlement.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ settlementId: '263' }),
      expect.objectContaining({ $set: expect.objectContaining({ totalAmount: 5380 }) }),
      expect.any(Object),
    );
    expect(MarketplaceSettlementLedgerLine.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ ledgerCategory: 'SETTLEMENT_ACTIVITY', 'rawReference.dedupKey': 'settlement-activity-1' }),
      expect.objectContaining({ $set: expect.objectContaining({ amount: 5380, sourceRef: base.sourceRef }) }),
      expect.any(Object),
    );
  });

  test('complete import batch only transitions a processing batch once', async () => {
    FinanceImportBatch.findOneAndUpdate.mockReturnValue(query());

    await repository.completeImportBatch('660000000000000000140011', {
      status: 'COMPLETED',
      processedRows: 1,
      validRows: 1,
      skippedRows: 0,
      unlinkedRows: 0,
      upserted: { ledgerLines: 1 },
      errors: [],
    });

    expect(FinanceImportBatch.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: '660000000000000000140011', status: 'PROCESSING' },
      expect.any(Object),
      expect.any(Object),
    );
  });

  test('finds the latest import batch for the same source content', async () => {
    const lean = jest.fn().mockResolvedValue({});
    FinanceImportBatch.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean }) });

    await repository.findImportBatchByContentHash({
      shopId: '660000000000000000140003',
      sourceType: 'ADS',
      contentHash: 'a'.repeat(64),
    });

    expect(FinanceImportBatch.findOne).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'ADS',
      contentHash: 'a'.repeat(64),
    }));
  });

  test('returns only normalized provenance for an order item', async () => {
    const queryWith = (rows) => ({ select: () => ({ sort: () => ({ lean: jest.fn().mockResolvedValue(rows) }) }) });
    MarketplaceSettlementLedgerLine.find.mockReturnValue(queryWith([{ sourceRef: 'settlement.txt', importBatchId: 'batch-ledger' }]));
    MarketplaceFeeLine.find.mockReturnValue(queryWith([{ sourceRef: 'transactions.csv', importBatchId: 'batch-fee', feeType: 'SELLING_FEE' }]));
    RefundRecord.find.mockReturnValue(queryWith([{ sourceRef: 'transactions.csv', importBatchId: 'batch-refund', externalRefundId: 'refund-1' }]));

    const result = await repository.listSourceReferencesByOrderItem('660000000000000000140003');

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'FEE', sourceRef: 'transactions.csv', importBatchId: 'batch-fee' }),
      expect.objectContaining({ sourceKind: 'REFUND', externalReference: 'refund-1' }),
    ]));
    expect(JSON.stringify(result)).not.toContain('rawReference');
  });

  test('returns each transaction with its imported fee breakdown', async () => {
    MarketplaceSettlementLedgerLine.find.mockReturnValue({
      sort: () => ({ skip: () => ({ limit: () => ({ lean: jest.fn().mockResolvedValue([
        {
          _id: 'transaction-1', amount: 4803, shopId: '660000000000000000140003', salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', rawReference: { dedupKey: 'txn-1' },
        },
      ]) }) }) }),
    });
    MarketplaceSettlementLedgerLine.countDocuments.mockResolvedValue(1);
    MarketplaceFeeLine.find.mockReturnValue({
      select: () => ({ lean: jest.fn().mockResolvedValue([
        { feeType: 'SELLING_FEES', totalFeeAmount: 325, shopId: '660000000000000000140003', salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', rawReference: { dedupKey: 'txn-1:SELLING_FEES' } },
        { feeType: 'OTHER_TRANSACTION_FEES', totalFeeAmount: 100, shopId: '660000000000000000140003', salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', rawReference: { dedupKey: 'txn-1:OTHER_TRANSACTION_FEES' } },
      ]) }),
    });

    const result = await repository.listImportedData('transactions', { page: 1, limit: 10 });

    expect(result.items[0]).toMatchObject({
      feeSummary: {
        totalAmount: 425,
        items: [
          { type: 'SELLING_FEES', amount: 325 },
          { type: 'OTHER_TRANSACTION_FEES', amount: 100 },
        ],
      },
    });
    expect(MarketplaceFeeLine.find).toHaveBeenCalledWith({
      $or: [{
        shopId: '660000000000000000140003',
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        'rawReference.dedupKey': { $in: ['txn-1:SELLING_FEES', 'txn-1:FBA_FEES', 'txn-1:OTHER_TRANSACTION_FEES'] },
      }],
    });
  });

  test('filters settlement rows by settlement id', async () => {
    MarketplaceSettlement.find.mockReturnValue({
      sort: () => ({ skip: () => ({ limit: () => ({ lean: jest.fn().mockResolvedValue([]) }) }) }),
    });
    MarketplaceSettlement.countDocuments.mockResolvedValue(0);

    await repository.listImportedData('settlements', { settlementId: '55493020701', page: 1, limit: 10 });

    expect(MarketplaceSettlement.find).toHaveBeenCalledWith(expect.objectContaining({
      settlementId: '55493020701',
    }));
  });

  test('summarizes a zero net settlement with its imported total payout', async () => {
    MarketplaceSettlement.find.mockReturnValue({
      sort: () => ({ skip: () => ({ limit: () => ({ lean: jest.fn().mockResolvedValue([]) }) }) }),
    });
    MarketplaceSettlement.countDocuments.mockResolvedValue(0);
    MarketplaceSettlement.aggregate
      .mockResolvedValueOnce([{ _id: 'USD', settlementCount: 1, totalAmount: 96215, netSettlementAmount: 96215 }])
      .mockResolvedValueOnce([]);

    const result = await repository.listSettlements({});

    const group = MarketplaceSettlement.aggregate.mock.calls[0][0].find((stage) => stage.$group).$group;
    expect(group.netSettlementAmount.$sum).toEqual({
      $cond: [{ $ne: ['$netSettlementAmount', 0] }, '$netSettlementAmount', '$totalAmount'],
    });
    expect(result.summaryByCurrency).toEqual([{
      currency: 'USD', settlementCount: 1, totalAmount: 96215, netSettlementAmount: 96215,
    }]);
  });
});
