jest.mock('../repositories/financeImport.repository');

const repository = require('../repositories/financeImport.repository');
const service = require('../services/financeImport.service');

const extensionAuth = {
  tokenType: 'EXTENSION',
  scopes: [{ scopeType: 'shop', scopeId: '507f1f77bcf86cd799439011' }],
};

describe('completed settlement import lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findCompletedSettlementImport = jest.fn();
  });

  test('reports a completed settlement only for the authenticated extension shop', async () => {
    repository.findCompletedSettlementImport.mockResolvedValue({ _id: 'batch-1' });

    await expect(service.hasCompletedSettlementImport('27554249931', extensionAuth))
      .resolves.toEqual({ completed: true });

    expect(repository.findCompletedSettlementImport).toHaveBeenCalledWith({
      shopId: '507f1f77bcf86cd799439011',
      referenceId: '27554249931',
    });
  });

  test('does not report an incomplete settlement as completed', async () => {
    repository.findCompletedSettlementImport.mockResolvedValue(null);

    await expect(service.hasCompletedSettlementImport('27554249931', extensionAuth))
      .resolves.toEqual({ completed: false });
  });

  test('rejects a caller without an extension shop scope', async () => {
    await expect(service.hasCompletedSettlementImport('27554249931', { tokenType: 'EXTENSION', scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
