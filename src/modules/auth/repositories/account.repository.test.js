const Account = require('../models/account.model');
const config = require('../../../config');
const { getRedisClient } = require('../../../config/redis');
const accountRepository = require('./account.repository');

jest.mock('../models/account.model', () => ({
  aggregate: jest.fn(),
  create: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../../config/redis', () => ({
  getRedisClient: jest.fn(),
}));

describe('accountRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.redis.enabled = false;
  });

  test('buildAuthAggregation resolves role and custom permission codes into a flat set', () => {
    const pipeline = accountRepository.buildAuthAggregation({ normalizedEmail: 'admin@example.com' });
    const pipelineJson = JSON.stringify(pipeline);

    expect(pipelineJson).toContain('rolePermissionDocs');
    expect(pipelineJson).toContain('customPermissionDocs');
    expect(pipelineJson).toContain('$setUnion');
    expect(pipelineJson).toContain('$toUpper');
  });

  test('findAuthAccountById uses cached permissions and avoids full permission aggregation on cache hit', async () => {
    config.redis.enabled = true;
    getRedisClient.mockReturnValue({
      get: jest.fn().mockResolvedValue(JSON.stringify(['ORDERS:READ'])),
    });
    Account.aggregate.mockResolvedValue([{
      account: { _id: 'account-id', email: 'admin@example.com', status: 'active' },
      profile: { _id: 'profile-id', accountId: 'account-id' },
      roles: ['OPERATOR'],
    }]);

    const result = await accountRepository.findAuthAccountById('507f1f77bcf86cd799439011');

    expect(result.permissions).toEqual(['ORDERS:READ']);
    expect(Account.aggregate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(Account.aggregate.mock.calls[0][0])).not.toContain('rolePermissionDocs');
  });

  test('findAuthAccountById runs full aggregation and sets ttl on Redis cache miss', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    config.redis.enabled = true;
    getRedisClient.mockReturnValue(redis);
    Account.aggregate.mockResolvedValue([{
      account: { _id: '507f1f77bcf86cd799439011', email: 'admin@example.com', status: 'active' },
      profile: { _id: 'profile-id', accountId: '507f1f77bcf86cd799439011' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    }]);

    const result = await accountRepository.findAuthAccountById('507f1f77bcf86cd799439011');

    expect(result.permissions).toEqual(['ORDERS:READ']);
    expect(JSON.stringify(Account.aggregate.mock.calls[0][0])).toContain('rolePermissionDocs');
    expect(redis.set).toHaveBeenCalledWith(
      'auth:permissions:507f1f77bcf86cd799439011',
      JSON.stringify(['ORDERS:READ']),
      'EX',
      300,
    );
  });
});
