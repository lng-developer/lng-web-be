jest.mock('../../../src/modules/finance/models/adsSpendDaily.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/financeImportBatch.model', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/marketplaceFeeLine.model', () => ({ findOneAndUpdate: jest.fn(), updateMany: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/marketplaceSettlement.model', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model', () => ({ findOneAndUpdate: jest.fn(), updateMany: jest.fn() }));
jest.mock('../../../src/modules/finance/models/refundRecord.model', () => ({ findOneAndUpdate: jest.fn(), updateMany: jest.fn(), aggregate: jest.fn() }));

const FinanceImportBatch = require('../../../src/modules/finance/models/financeImportBatch.model');
const MarketplaceSettlementLedgerLine = require('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model');
const MarketplaceFeeLine = require('../../../src/modules/finance/models/marketplaceFeeLine.model');
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

  test('finds an existing batch by idempotency scope', async () => {
    FinanceImportBatch.findOne.mockReturnValue(query());

    await repository.findImportBatchByIdempotency({
      shopId: '660000000000000000140003',
      sourceType: 'TRANSACTIONS',
      idempotencyKey: 'sha256:transactions-key',
    });

    expect(FinanceImportBatch.findOne).toHaveBeenCalledWith({
      shopId: expect.anything(),
      sourceType: 'TRANSACTIONS',
      idempotencyKey: 'sha256:transactions-key',
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

  test('links unlinked source rows by order identity and item identity', async () => {
    MarketplaceSettlementLedgerLine.updateMany.mockResolvedValue({ matchedCount: 1 });
    MarketplaceFeeLine.updateMany.mockResolvedValue({ matchedCount: 2 });
    RefundRecord.updateMany.mockResolvedValue({ matchedCount: 0 });

    const result = await repository.linkUnlinkedFinanceRowsForOrderItem({
      shopId: '660000000000000000140003',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '114-1',
      externalItemId: 'item-1',
      sku: 'SKU-1',
      orderId: '660000000000000000140001',
      orderItemId: '660000000000000000140002',
    });

    expect(result).toEqual({ linkedCount: 3 });
    expect(MarketplaceSettlementLedgerLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderItemId: null, $or: expect.any(Array) }),
      expect.objectContaining({ $set: expect.objectContaining({ orderItemId: '660000000000000000140002' }) }),
    );
  });
});
