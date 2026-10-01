jest.mock('../../../src/modules/finance/models/marketplaceFeeLine.model', () => ({
  collection: { name: 'marketplacefeelines' },
  aggregate: jest.fn(),
}));
jest.mock('../../../src/modules/finance/models/marketplaceSettlement.model', () => ({
  aggregate: jest.fn(),
}));
jest.mock('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model', () => ({
  collection: { name: 'marketplacesettlementledgerlines' },
  aggregate: jest.fn(),
}));
jest.mock('../../../src/modules/finance/models/financeImportBatch.model', () => ({ aggregate: jest.fn() }));

const MarketplaceSettlementLedgerLine = require('../../../src/modules/finance/models/marketplaceSettlementLedgerLine.model');
const MarketplaceSettlement = require('../../../src/modules/finance/models/marketplaceSettlement.model');
const FinanceImportBatch = require('../../../src/modules/finance/models/financeImportBatch.model');
const repository = require('../../../src/modules/finance/repositories/financeCashFlow.repository');

describe('financeCashFlow.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses the scoped shop ids in the movement aggregate', async () => {
    MarketplaceSettlementLedgerLine.aggregate.mockResolvedValue([{ items: [], total: [] }]);
    MarketplaceSettlement.aggregate.mockResolvedValue([]);
    FinanceImportBatch.aggregate.mockResolvedValue([]);

    await repository.getCashFlow({
      shopIds: ['660000000000000000140003'],
      status: 'UNLINKED',
      page: 1,
      limit: 20,
    });

    expect(MarketplaceSettlementLedgerLine.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $match: expect.objectContaining({ shopId: { $in: expect.any(Array) } }),
      }),
      expect.objectContaining({ $match: { reconciliationStatus: 'UNLINKED' } }),
    ]));
  });

  test('does not classify an Order-only row as item-linked', () => {
    expect(repository.reconciliationStatus({ orderId: 'order-1', orderItemId: null })).toBe('NEEDS_REVIEW');
  });

  test('intersects a requested shop with the authorized shop scope', () => {
    const filter = repository.scopeFilter({
      shopId: '660000000000000000140003',
      shopIds: ['660000000000000000140003', '660000000000000000140004'],
    });
    expect(String(filter.shopId)).toBe('660000000000000000140003');
    expect(filter.shopId.$in).toBeUndefined();
  });

  test('returns no rows when the requested shop is outside the authorized scope', () => {
    const filter = repository.scopeFilter({
      shopId: '660000000000000000140003',
      shopIds: ['660000000000000000140004'],
    });

    expect(filter.shopId.$in).toEqual([]);
  });
})
