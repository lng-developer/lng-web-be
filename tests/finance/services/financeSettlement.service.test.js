jest.mock('../../../src/modules/finance/repositories/financeImport.repository', () => ({
  listSettlements: jest.fn(),
  getSettlement: jest.fn(),
  listSettlementLedgerLines: jest.fn(),
}));
jest.mock('../../../src/modules/finance/services/financeAccess.service', () => ({
  hasGlobal: jest.fn(),
  settlementScopedQuery: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));

const repository = require('../../../src/modules/finance/repositories/financeImport.repository');
const financeAccess = require('../../../src/modules/finance/services/financeAccess.service');
const service = require('../../../src/modules/finance/services/financeSettlement.service');

test('settlement cash summary exposes payout variance and link coverage without order-profit allocation', async () => {
  financeAccess.hasGlobal.mockReturnValue(true);
  repository.listSettlements.mockResolvedValue({
    items: [{
      _id: 'settlement-1', totalAmount: 96215,
      ledgerSummary: { netAmount: 95000, lineCount: 4, linkedCount: 3 },
    }],
    total: 1, page: 1, limit: 20,
  });

  await expect(service.listSettlements({}, { permissions: ['FINANCE:READ'] })).resolves.toMatchObject({
    items: [expect.objectContaining({
      ledgerSummary: expect.objectContaining({
        payoutAmount: 96215,
        ledgerNetAmount: 95000,
        cashVarianceAmount: 1215,
        linkCoverageBps: 7500,
      }),
    })],
  });
});

test('settlement detail is not found outside the caller shop scope', async () => {
  financeAccess.settlementScopedQuery.mockReturnValue({ shopIds: ['shop-a'] });
  repository.getSettlement.mockResolvedValue({ _id: 'settlement-1', shopId: 'shop-b' });

  await expect(service.getSettlement('settlement-1', {}, { permissions: [] }))
    .rejects.toMatchObject({ statusCode: 404 });
});

test('settlement DTO defaults reconciliation state to open', async () => {
  financeAccess.settlementScopedQuery.mockReturnValue({});
  repository.listSettlements.mockResolvedValue({
    items: [{ _id: 'settlement-1', totalAmount: 100, ledgerSummary: {} }], total: 1, page: 1, limit: 20,
  });

  await expect(service.listSettlements({}, { permissions: [] })).resolves.toMatchObject({
    items: [expect.objectContaining({ reconciliation: {
      status: 'OPEN', note: null, reconciledAt: null, reconciledByAccountId: null,
    } })],
  });
});

test('cannot reconcile a settlement with an unresolved variance', async () => {
  financeAccess.settlementScopedQuery.mockReturnValue({});
  repository.getSettlement.mockResolvedValue({ _id: 'settlement-1', shopId: 'shop-a', totalAmount: 100 });
  repository.listSettlementLedgerLines.mockResolvedValue({ summary: { netAmount: 90, lineCount: 1, linkedCount: 1 } });

  await expect(service.reconcileSettlement('settlement-1', { status: 'RECONCILED' }, { permissions: [] }, {}))
    .rejects.toMatchObject({ statusCode: 409 });
});
