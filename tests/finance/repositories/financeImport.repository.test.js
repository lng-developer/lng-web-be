jest.mock('../../../src/modules/finance/models/adsSpendDaily.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/financeImportBatch.model', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/marketplaceFeeLine.model', () => ({ findOneAndUpdate: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/marketplaceSettlement.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/refundRecord.model', () => ({ findOneAndUpdate: jest.fn(), aggregate: jest.fn() }));

const FinanceImportBatch = require('../../../src/modules/finance/models/financeImportBatch.model');
const MarketplaceSettlementLedgerLine = require('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model');
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
});
