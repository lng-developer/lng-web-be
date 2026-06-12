const ScopeRegistry = require('../models/scopeRegistry.model');
const scopeRegistryRepository = require('./scopeRegistry.repository');

jest.mock('../models/scopeRegistry.model', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

describe('scopeRegistryRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('findActiveByScope reads active scope registry entry with lean', async () => {
    const lean = jest.fn().mockResolvedValue({
      _id: 'scope-registry-id',
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      status: 'active',
    });
    ScopeRegistry.findOne.mockReturnValue({ lean });

    const result = await scopeRegistryRepository.findActiveByScope('team', '507f1f77bcf86cd799439088');

    expect(ScopeRegistry.findOne).toHaveBeenCalledWith({
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      status: 'active',
    });
    expect(lean).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('active');
  });
});
