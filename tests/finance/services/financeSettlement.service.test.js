jest.mock('../../../src/modules/finance/repositories/financeImport.repository', () => ({
  listSettlements: jest.fn(),
  getSettlement: jest.fn(),
  listSettlementLedgerLines: jest.fn(),
}));
jest.mock('../../../src/modules/finance/services/financeAccess.service', () => ({ hasGlobal: jest.fn() }));

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
