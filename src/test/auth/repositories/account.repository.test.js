const Account = require('../../../modules/auth/models/account.model');
const config = require('../../../config');
const { getRedisClient } = require('../../../config/redis');
const accountRepository = require('../../../modules/auth/repositories/account.repository');

jest.mock('../../../modules/auth/models/account.model', () => ({
  aggregate: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
  countDocuments: jest.fn(),
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

    expect(pipelineJson).toContain('accessassignments');
    expect(pipelineJson).toContain('scopedrolepermissions');
    expect(pipelineJson).toContain('permissionDocs');
    expect(pipelineJson).toContain('globalScopes');
    expect(pipelineJson).toContain('$setUnion');
    expect(pipelineJson).toContain('$toUpper');
  });

  test('findAuthAccountById uses cached permissions and avoids full permission aggregation on cache hit', async () => {
    config.redis.enabled = true;
    getRedisClient.mockReturnValue({
      get: jest.fn().mockResolvedValue(JSON.stringify({
        roles: ['OPERATOR'],
        permissions: ['ORDERS:READ'],
        scopes: [],
      })),
    });
    Account.aggregate.mockResolvedValue([{
      account: { _id: 'account-id', email: 'admin@example.com', status: 'active' },
      profile: { _id: 'profile-id', accountId: 'account-id' },
    }]);

    const result = await accountRepository.findAuthAccountById('507f1f77bcf86cd799439011');

    expect(result.roles).toEqual(['OPERATOR']);
    expect(result.permissions).toEqual(['ORDERS:READ']);
    expect(result.scopes).toEqual([]);
    expect(Account.aggregate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(Account.aggregate.mock.calls[0][0])).not.toContain('accessassignments');
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
      scopes: [],
    }]);

    const result = await accountRepository.findAuthAccountById('507f1f77bcf86cd799439011');

    expect(result.permissions).toEqual(['ORDERS:READ']);
    expect(JSON.stringify(Account.aggregate.mock.calls[0][0])).toContain('accessassignments');
    expect(redis.set).toHaveBeenCalledWith(
      'auth:permissions:507f1f77bcf86cd799439011',
      JSON.stringify({
        roles: ['OPERATOR'],
        permissions: ['ORDERS:READ'],
        scopes: [],
      }),
      'EX',
      300,
    );
  });

  test('updatePassword increments tokenVersion and revokes active refresh sessions', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id', email: 'admin@example.com' });
    const select = jest.fn().mockReturnValue({ lean });
    Account.findByIdAndUpdate.mockReturnValue({ select });

    await accountRepository.updatePassword('507f1f77bcf86cd799439011', {
      passwordHash: 'next-hash',
      passwordSalt: 'next-salt',
    });

    const update = Account.findByIdAndUpdate.mock.calls[0][1];
    const options = Account.findByIdAndUpdate.mock.calls[0][2];

    expect(update.$inc).toEqual({ tokenVersion: 1 });
    expect(update.$set.passwordHash).toBe('next-hash');
    expect(update.$set.passwordSalt).toBe('next-salt');
    expect(update.$set['sessions.$[activeSession].revokedAt']).toBeInstanceOf(Date);
    expect(options.arrayFilters[0]['activeSession.revokedAt']).toBeNull();
    expect(options.arrayFilters[0]['activeSession.expiresAt'].$gt).toBeInstanceOf(Date);
    expect(select).toHaveBeenCalledWith('-passwordHash -passwordSalt -sessions');
  });

  test('updateEmail increments tokenVersion, changes emails, and revokes active sessions in transaction', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id', email: 'new.admin@lng.co' });
    const select = jest.fn().mockReturnValue({ lean });
    Account.findByIdAndUpdate.mockReturnValue({ select });
    const session = { id: 'session' };

    await accountRepository.updateEmail('507f1f77bcf86cd799439011', {
      email: 'new.admin@lng.co',
      normalizedEmail: 'new.admin@lng.co',
    }, { session });

    const update = Account.findByIdAndUpdate.mock.calls[0][1];
    const options = Account.findByIdAndUpdate.mock.calls[0][2];

    expect(update.$inc).toEqual({ tokenVersion: 1 });
    expect(update.$set.email).toBe('new.admin@lng.co');
    expect(update.$set.normalizedEmail).toBe('new.admin@lng.co');
    expect(update.$set['sessions.$[activeSession].revokedAt']).toBeInstanceOf(Date);
    expect(options.session).toBe(session);
    expect(options.arrayFilters[0]['activeSession.revokedAt']).toBeNull();
  });

  test('archive sets archived status and revokes active sessions', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id', status: 'archived' });
    const select = jest.fn().mockReturnValue({ lean });
    Account.findByIdAndUpdate.mockReturnValue({ select });

    await accountRepository.archive('507f1f77bcf86cd799439011');

    const update = Account.findByIdAndUpdate.mock.calls[0][1];

    expect(update.$inc).toEqual({ tokenVersion: 1 });
    expect(update.$set.status).toBe('archived');
    expect(update.$set['sessions.$[activeSession].revokedAt']).toBeInstanceOf(Date);
  });

  test('revokeActiveSessions increments tokenVersion and revokes active sessions', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id', email: 'admin@example.com' });
    const select = jest.fn().mockReturnValue({ lean });
    Account.findByIdAndUpdate.mockReturnValue({ select });

    await accountRepository.revokeActiveSessions('507f1f77bcf86cd799439011');

    const update = Account.findByIdAndUpdate.mock.calls[0][1];
    const options = Account.findByIdAndUpdate.mock.calls[0][2];

    expect(update.$inc).toEqual({ tokenVersion: 1 });
    expect(update.$set['sessions.$[activeSession].revokedAt']).toBeInstanceOf(Date);
    expect(options.arrayFilters[0]['activeSession.revokedAt']).toBeNull();
    expect(options.arrayFilters[0]['activeSession.expiresAt'].$gt).toBeInstanceOf(Date);
    expect(select).toHaveBeenCalledWith('-passwordHash -passwordSalt -sessions');
  });
});
