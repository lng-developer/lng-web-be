const repository = require('../../../src/modules/finance/repositories/financeImport.repository');
const service = require('../../../src/modules/finance/services/financeSettlement.service');

jest.mock('../../../src/modules/finance/repositories/financeImport.repository', () => ({
  listSettlements: jest.fn(),
  getSettlement: jest.fn(),
  listSettlementLedgerLines: jest.fn(),
}));

describe('financeSettlement.service', () => {
  beforeEach(() => jest.resetAllMocks());

  test('lists settlement summaries for finance readers', async () => {
    repository.listSettlements.mockResolvedValue({
      items: [{ _id: 'settlement-1', settlementId: 'S-1', totalAmount: 96215 }],
      total: 1,
      page: 1,
      limit: 20,
      summaryByCurrency: [{ currency: 'USD', netSettlementAmount: 96215 }],
    });

    await expect(service.listSettlements({ page: 1, limit: 20 }, { permissions: ['FINANCE:READ'] }))
      .resolves.toMatchObject({
        items: [{ id: 'settlement-1', settlementId: 'S-1', totalAmount: 96215 }],
        summaryByCurrency: [{ currency: 'USD', netSettlementAmount: 96215 }],
      });
  });

  test('returns one settlement with paginated ledger details', async () => {
    repository.getSettlement.mockResolvedValue({ _id: 'settlement-1', settlementId: 'S-1' });
    repository.listSettlementLedgerLines.mockResolvedValue({
      items: [{ _id: 'line-1', amount: 5180, orderItemId: 'item-1' }],
      total: 1,
      page: 1,
      limit: 20,
      summary: { inflowAmount: 5180, outflowAmount: 0, netAmount: 5180, linkedCount: 1, unlinkedCount: 0 },
    });

    await expect(service.getSettlement('settlement-1', { page: 1, limit: 20 }, { permissions: ['FINANCE:READ'] }))
      .resolves.toMatchObject({
        settlement: { id: 'settlement-1', settlementId: 'S-1' },
        ledger: { items: [{ id: 'line-1', amount: 5180, orderItemId: 'item-1' }] },
      });
  });
});
