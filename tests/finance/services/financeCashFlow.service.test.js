jest.mock('../../../src/modules/finance/repositories/financeCashFlow.repository', () => ({ getCashFlow: jest.fn() }));

const repository = require('../../../src/modules/finance/repositories/financeCashFlow.repository');
const service = require('../../../src/modules/finance/services/financeCashFlow.service');

describe('financeCashFlow.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('adds shop scope before calling the repository', async () => {
    repository.getCashFlow.mockResolvedValue({ summaryByCurrency: [], items: [], pagination: { total: 0, page: 1, limit: 20 } });

    await service.getCashFlow(
      { page: 1, limit: 20 },
      { scopes: [{ scopeType: 'shop', scopeId: '660000000000000000140003', permissions: ['FINANCE:READ'] }] },
    );

    expect(repository.getCashFlow).toHaveBeenCalledWith(expect.objectContaining({
      shopIds: ['660000000000000000140003'],
    }));
  });

  test('rejects a reader without global or shop scope', async () => {
    await expect(service.getCashFlow({}, { permissions: [], scopes: [] })).rejects.toMatchObject({ statusCode: 403 });
  });
})
