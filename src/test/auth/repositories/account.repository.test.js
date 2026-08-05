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
    const pipeline = accountRepository.buildAuthAggregation({ email: 'admin@example.com' });
    const pipelineJson = JSON.stringify(pipeline);

    expect(pipelineJson).toContain('accessassignments');
    expect(pipelineJson).toContain('scopedrolepermissions');
    expect(pipelineJson).toContain('permissionDocs');
    expect(pipelineJson).toContain('globalScopes');
    expect(pipelineJson).toContain('$setUnion');
    expect(pipelineJson).toContain('$toUpper');
    expect(pipelineJson).toContain('overridePermissions');
    expect(pipelineJson).toContain('isPermissionOverridden');
    expect(pipelineJson).toContain('effectivePermissionIds');
    expect(pipelineJson).toContain('inheritedPermissionIds');
    expect(pipelineJson).toContain('mustChangePassword');
    expect(pipelineJson).not.toContain('userprofiles');
  });

  test('buildAuthAggregation ignores null assignment overrides when collecting permission ids', () => {
    const pipeline = accountRepository.buildAuthAggregation({ email: 'staff@example.com' });
    const permissionStage = pipeline.find(
      (stage) => stage.$addFields?.assignmentOverridePermissionIds,
    );

    expect(permissionStage.$addFields.assignmentOverridePermissionIds.$reduce.in).toEqual({
      $setUnion: ['$$value', { $ifNull: ['$$this', []] }],
    });
  });

  test('list filters by account email, role, department, and team before pagination', async () => {
    Account.aggregate.mockResolvedValueOnce([{ _id: 'account-id' }]).mockResolvedValueOnce([{ total: 1 }]);

    await accountRepository.list({
      search: 'j2501',
      roleCode: 'LEADER',
      departmentId: '660000000000000000000001',
      teamId: '660000000000000000000101',
      page: 1,
      limit: 20,
    });

    const pipelineJson = JSON.stringify(Account.aggregate.mock.calls[0][0]);

    expect(pipelineJson).toContain('email');
    expect(pipelineJson).not.toContain('profile.');
    expect(pipelineJson).toContain('roleAssignments.roleCode');
    expect(pipelineJson).toContain('department');
    expect(pipelineJson).toContain('team');
    expect(pipelineJson.indexOf('$match')).toBeLessThan(pipelineJson.indexOf('$skip'));
    expect(Account.countDocuments).not.toHaveBeenCalled();
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
      mustChangePassword: false,
    });

    const update = Account.findByIdAndUpdate.mock.calls[0][1];
    const options = Account.findByIdAndUpdate.mock.calls[0][2];

    expect(update.$inc).toEqual({ tokenVersion: 1 });
    expect(update.$set.passwordHash).toBe('next-hash');
    expect(update.$set.passwordSalt).toBe('next-salt');
    expect(update.$set.mustChangePassword).toBe(false);
    expect(update.$set['sessions.$[activeSession].revokedAt']).toBeInstanceOf(Date);
    expect(options.arrayFilters[0]['activeSession.revokedAt']).toBeNull();
    expect(options.arrayFilters[0]['activeSession.expiresAt'].$gt).toBeInstanceOf(Date);
    expect(select).toHaveBeenCalledWith('-passwordHash -passwordSalt -sessions');
  });

  test('findByIdWithPassword selects credentials without refresh sessions', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id' });
    const select = jest.fn().mockReturnValue({ lean });
    Account.findById.mockReturnValue({ select });
    const session = { id: 'session' };

    await accountRepository.findByIdWithPassword('507f1f77bcf86cd799439011', { session });

    expect(Account.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011', null, { session });
    expect(select).toHaveBeenCalledWith('+passwordHash +passwordSalt -sessions');
  });

  test('updatePassword requires verified current credentials when provided', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id' });
    const select = jest.fn().mockReturnValue({ lean });
    Account.findOneAndUpdate.mockReturnValue({ select });

    await accountRepository.updatePassword('507f1f77bcf86cd799439011', {
      passwordHash: 'next-hash',
      passwordSalt: 'next-salt',
      mustChangePassword: false,
    }, {
      expectedPassword: { passwordHash: 'current-hash', passwordSalt: 'current-salt' },
    });

    expect(Account.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
      _id: '507f1f77bcf86cd799439011',
      passwordHash: 'current-hash',
      passwordSalt: 'current-salt',
    }), expect.any(Object), expect.any(Object));
    expect(Account.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('updateEmail increments tokenVersion, changes the login email, and revokes active sessions', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id', email: 'new.admin@lng.co' });
    const select = jest.fn().mockReturnValue({ lean });
    Account.findByIdAndUpdate.mockReturnValue({ select });
    const session = { id: 'session' };

    await accountRepository.updateEmail('507f1f77bcf86cd799439011', 'new.admin@lng.co', { session });

    const update = Account.findByIdAndUpdate.mock.calls[0][1];
    const options = Account.findByIdAndUpdate.mock.calls[0][2];

    expect(update.$inc).toEqual({ tokenVersion: 1 });
    expect(update.$set.email).toBe('new.admin@lng.co');
    expect(update.$set).not.toHaveProperty('normalizedEmail');
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

  test('rotateRefreshSession updates sessions with a single pipeline path to avoid Mongo path conflicts', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id' });
    Account.findOneAndUpdate.mockReturnValue({ lean });
    const nextSession = {
      sessionId: 'next-session-id',
      refreshTokenHash: 'next-refresh-hash',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      revokedAt: null,
      replacedBySessionId: null,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    };

    await accountRepository.rotateRefreshSession('current-refresh-hash', nextSession);

    const filter = Account.findOneAndUpdate.mock.calls[0][0];
    const update = Account.findOneAndUpdate.mock.calls[0][1];
    const options = Account.findOneAndUpdate.mock.calls[0][2];

    expect(filter.sessions.$elemMatch.refreshTokenHash).toBe('current-refresh-hash');
    expect(Array.isArray(update)).toBe(true);
    expect(JSON.stringify(update)).toContain('current-refresh-hash');
    expect(JSON.stringify(update)).toContain('next-refresh-hash');
    expect(JSON.stringify(update)).toContain('replacedBySessionId');
    expect(JSON.stringify(update)).toContain('"$slice"');
    expect(JSON.stringify(update)).not.toContain('"$push"');
    expect(options).toEqual({ returnDocument: 'after', updatePipeline: true });
    expect(lean).toHaveBeenCalledTimes(1);
  });

  test('appendSession caps stored refresh sessions', async () => {
    Account.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const session = {
      sessionId: 'session-id',
      refreshTokenHash: 'refresh-hash',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      revokedAt: null,
      replacedBySessionId: null,
    };

    await accountRepository.appendSession('507f1f77bcf86cd799439011', session);

    expect(Account.updateOne).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd799439011' },
      {
        $push: {
          sessions: {
            $each: [session],
            $slice: -50,
          },
        },
      },
      { session: undefined },
    );
  });

  test('rotateRefreshSession caps stored refresh sessions after token rotation', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id' });
    Account.findOneAndUpdate.mockReturnValue({ lean });
    const nextSession = {
      sessionId: 'next-session-id',
      refreshTokenHash: 'next-refresh-hash',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      revokedAt: null,
      replacedBySessionId: null,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    };

    await accountRepository.rotateRefreshSession('current-refresh-hash', nextSession);

    const updateJson = JSON.stringify(Account.findOneAndUpdate.mock.calls[0][1]);

    expect(updateJson).toContain('"$slice"');
    expect(updateJson).toContain('-50');
  });

  test('session mutations forward the owning transaction session', async () => {
    const transactionSession = { id: 'auth-transaction' };
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id' });
    Account.findOneAndUpdate.mockReturnValue({ lean });
    Account.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const nextSession = {
      sessionId: 'next-session-id',
      refreshTokenHash: 'next-refresh-hash',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    };

    await accountRepository.rotateRefreshSession('current-refresh-hash', nextSession, {
      session: transactionSession,
    });
    await accountRepository.revokeRefreshSession('current-refresh-hash', {
      session: transactionSession,
    });
    await accountRepository.updateLastLogin('507f1f77bcf86cd799439011', '127.0.0.1', {
      session: transactionSession,
    });

    expect(Account.findOneAndUpdate.mock.calls[0][2]).toEqual({
      returnDocument: 'after',
      updatePipeline: true,
      session: transactionSession,
    });
    expect(Account.updateOne.mock.calls[0][2]).toEqual({ session: transactionSession });
    expect(Account.updateOne.mock.calls[1][2]).toEqual({ session: transactionSession });
  });

  test('findAccountByRefreshToken locates historical tokens inside the transaction', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id' });
    const transactionSession = { id: 'auth-transaction' };
    Account.findOne.mockReturnValue({ lean });

    await accountRepository.findAccountByRefreshToken('historical-hash', {
      session: transactionSession,
    });

    expect(Account.findOne).toHaveBeenCalledWith({
      'sessions.refreshTokenHash': 'historical-hash',
    }, null, { session: transactionSession });
    expect(lean).toHaveBeenCalledTimes(1);
  });

  test('revokeRefreshSessionAndReturn atomically attributes a real active-token revoke', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id' });
    const transactionSession = { id: 'auth-transaction' };
    Account.findOneAndUpdate.mockReturnValue({ lean });

    await accountRepository.revokeRefreshSessionAndReturn('active-hash', {
      session: transactionSession,
    });

    const [filter, update, options] = Account.findOneAndUpdate.mock.calls[0];
    expect(filter.sessions.$elemMatch).toMatchObject({ refreshTokenHash: 'active-hash', revokedAt: null });
    expect(update.$set['sessions.$.revokedAt']).toBeInstanceOf(Date);
    expect(options).toEqual({ returnDocument: 'after', session: transactionSession });
  });

  test('revokeRefreshSessionFamily revokes successors and increments tokenVersion atomically', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'account-id', tokenVersion: 4 });
    const transactionSession = { id: 'auth-transaction' };
    Account.findOneAndUpdate.mockReturnValue({ lean });

    await accountRepository.revokeRefreshSessionFamily(
      '507f1f77bcf86cd799439011',
      ['old-session', 'live-successor'],
      { session: transactionSession },
    );

    const [filter, pipeline, options] = Account.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: '507f1f77bcf86cd799439011' });
    expect(JSON.stringify(pipeline)).toContain('live-successor');
    expect(JSON.stringify(pipeline)).toContain('tokenVersion');
    expect(options).toEqual({ returnDocument: 'after', updatePipeline: true, session: transactionSession });
  });
});
