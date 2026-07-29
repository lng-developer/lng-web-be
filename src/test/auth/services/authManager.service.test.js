const mongoose = require('mongoose');
const accountRepository = require('../../../modules/auth/repositories/account.repository');
const roleRepository = require('../../../modules/auth/repositories/role.repository');
const accessAssignmentRepository = require('../../../modules/auth/repositories/accessAssignment.repository');
const hrPublic = require('../../../modules/hr/public');
const auditPublic = require('../../../modules/audit/public');
const logger = require('../../../shared/utils/logger');
const cryptoUtils = require('../../../shared/utils/crypto');
const { hashPassword } = cryptoUtils;
const { accountStatuses } = require('../../../modules/auth/constants/auth.constants');
const authManager = require('../../../modules/auth/services/authManager.service');

jest.mock('../../../modules/auth/repositories/account.repository');
jest.mock('../../../modules/auth/repositories/role.repository');
jest.mock('../../../modules/auth/repositories/accessAssignment.repository');
jest.mock('../../../modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ warn: jest.fn() }));
jest.mock('../../../shared/utils/crypto', () => {
  const actual = jest.requireActual('../../../shared/utils/crypto');
  return { ...actual, verifyPassword: jest.fn(actual.verifyPassword) };
});
jest.mock('../../../modules/hr/public', () => ({
  getEmployeeProfileByEmployeeCode: jest.fn(),
}));

describe('authManager', () => {
  let session;

  beforeEach(() => {
    jest.resetAllMocks();
    auditPublic.record.mockResolvedValue({});
    cryptoUtils.verifyPassword.mockImplementation(
      jest.requireActual('../../../shared/utils/crypto').verifyPassword,
    );
    session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
  });

  afterEach(() => {
    mongoose.startSession.mockRestore();
  });

  test('register creates an Account without requiring an employee profile', async () => {
    accountRepository.findByEmail.mockResolvedValue(null);
    roleRepository.findByCode.mockResolvedValue({ _id: 'role-id', code: 'OPERATOR' });
    accountRepository.create.mockResolvedValue({ _id: 'account-id', email: 'admin@example.com', status: 'active' });

    const result = await authManager.register('Admin@Example.com ', 'valid-password', 'Admin', {
      requestId: 'register-request', ipAddress: '127.0.0.5', userAgent: 'register-agent',
    });

    expect(result.account.email).toBe('admin@example.com');
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(accountRepository.create.mock.calls[0][1]).toEqual({ session });
    expect(result).not.toHaveProperty('profile');
    expect(accessAssignmentRepository.create).toHaveBeenCalledWith({
      accountId: 'account-id',
      roleId: 'role-id',
      scopeType: 'global',
      scopeId: null,
      status: 'active',
    }, { session });
    expect(auditPublic.record).toHaveBeenCalledWith({
      actorType: 'ACCOUNT',
      actorAccountId: 'account-id',
      action: 'ACCOUNT_CREATED',
      entityType: 'AUTH_ACCOUNT',
      entityId: 'account-id',
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      requestId: 'register-request',
      ipAddress: '127.0.0.5',
      userAgent: 'register-agent',
      metadata: {},
      deduplicationKey: 'auth:register:account-id',
    }, { session });
    expect(JSON.stringify(auditPublic.record.mock.calls[0][0])).not.toMatch(/admin@example\.com|valid-password|password|token/i);
    expect(session.endSession).toHaveBeenCalledTimes(1);

  });

  test('register maps duplicate key errors to conflict', async () => {
    accountRepository.findByEmail.mockResolvedValue(null);
    roleRepository.findByCode.mockResolvedValue({ _id: 'role-id', code: 'OPERATOR' });
    accountRepository.create.mockRejectedValue({ code: 11000 });

    await expect(authManager.register('admin@example.com', 'valid-password', 'Admin')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test('login validates password and returns tokens with resolved permissions', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    const authModel = {
      account: {
        _id: '507f1f77bcf86cd799439011',
        email: 'admin@example.com',
        passwordHash,
        passwordSalt,
        tokenVersion: 2,
        status: accountStatuses.ACTIVE,
      },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    };
    accountRepository.findAuthAccountByEmail.mockResolvedValue(authModel);
    accountRepository.appendSession.mockResolvedValue({});
    accountRepository.updateLastLogin.mockResolvedValue({});

    const result = await authManager.login('admin@example.com', 'valid-password', {
      requestId: 'login-request',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.permissions).toEqual(['ORDERS:READ']);
    expect(result.scopes).toEqual([]);
    expect(authManager.verifyAccessToken(result.accessToken).tokenVersion).toBe(2);
    expect(accountRepository.appendSession).toHaveBeenCalledTimes(1);
    expect(auditPublic.record).toHaveBeenCalledWith({
      actorType: 'ACCOUNT',
      actorAccountId: '507f1f77bcf86cd799439011',
      action: 'AUTH_LOGIN_SUCCEEDED',
      entityType: 'AUTH_ACCOUNT',
      entityId: '507f1f77bcf86cd799439011',
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      requestId: 'login-request',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      metadata: {},
      deduplicationKey: expect.stringMatching(/^auth:login:[a-f0-9]+$/),
    }, { session });
    expect(accountRepository.appendSession).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011', expect.any(Object), { session },
    );
    expect(accountRepository.updateLastLogin).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011', '127.0.0.1', { session },
    );
  });

  test.each([
    {
      name: 'unknown account',
      find: null,
      actorType: 'ANONYMOUS',
      actorAccountId: null,
      reason: 'INVALID_CREDENTIALS',
    },
    {
      name: 'inactive account',
      find: { account: { _id: '507f1f77bcf86cd799439011', status: accountStatuses.INACTIVE } },
      actorType: 'ANONYMOUS',
      actorAccountId: null,
      reason: 'INVALID_CREDENTIALS',
    },
    {
      name: 'wrong password',
      find: null,
      wrongPassword: true,
      actorType: 'ANONYMOUS',
      actorAccountId: null,
      reason: 'INVALID_CREDENTIALS',
    },
  ])('login audits $name without credentials', async ({ find, wrongPassword, actorType, actorAccountId, reason }) => {
    if (wrongPassword) {
      const { passwordHash, passwordSalt } = await hashPassword('correct-password');
      find = {
        account: {
          _id: '507f1f77bcf86cd799439011',
          status: accountStatuses.ACTIVE,
          passwordHash,
          passwordSalt,
        },
      };
    }
    accountRepository.findAuthAccountByEmail.mockResolvedValue(find);

    await expect(authManager.login('private@example.com', 'never-store-me', {
      requestId: `login-${reason.toLowerCase()}`,
      ipAddress: '127.0.0.2',
      userAgent: 'failure-agent',
    })).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });

    const event = auditPublic.record.mock.calls[0][0];
    expect(event).toEqual(expect.objectContaining({
      actorType,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'AUTH_ACCOUNT',
      entityId: 'UNKNOWN',
      outcome: 'FAILED',
      source: 'HTTP',
      metadata: { reason },
    }));
    expect(event.actorAccountId).toBe(actorAccountId);
    expect(JSON.stringify(event)).not.toMatch(/private@example\.com|never-store-me|password|token|authorization|cookie/i);
  });

  test('unknown, inactive, and wrong-password login paths each pay one password verification cost', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('correct-password');
    accountRepository.findAuthAccountByEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        account: { _id: '507f1f77bcf86cd799439011', status: accountStatuses.INACTIVE },
      })
      .mockResolvedValueOnce({
        account: {
          _id: '507f1f77bcf86cd799439011',
          status: accountStatuses.ACTIVE,
          passwordHash,
          passwordSalt,
        },
      });

    for (const [identifier, password] of [
      ['missing@example.com', 'attempt-one'],
      ['inactive@example.com', 'attempt-two'],
      ['active@example.com', 'wrong-password'],
    ]) {
      await expect(authManager.login(identifier, password, { requestId: identifier }))
        .rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });
    }

    expect(cryptoUtils.verifyPassword).toHaveBeenCalledTimes(3);
    expect(cryptoUtils.verifyPassword.mock.calls[0].slice(1)).toEqual(
      cryptoUtils.verifyPassword.mock.calls[1].slice(1),
    );
    expect(cryptoUtils.verifyPassword.mock.calls[0][1]).toMatch(/^[a-f0-9]{128}$/);
    expect(cryptoUtils.verifyPassword.mock.calls[2].slice(1)).toEqual([passwordHash, passwordSalt]);
  });

  test('login preserves the authentication rejection when failure auditing fails', async () => {
    accountRepository.findAuthAccountByEmail.mockResolvedValue(null);
    auditPublic.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(authManager.login('missing@example.com', 'secret', {
      requestId: 'failed-login-audit',
    })).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });
    expect(logger.warn).toHaveBeenCalledWith('auth_failure_audit_failed', {
      requestId: 'failed-login-audit',
      error: expect.objectContaining({ message: 'audit unavailable' }),
    });
  });

  test('login rolls back its transaction and surfaces a success-audit failure', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    accountRepository.findAuthAccountByEmail.mockResolvedValue({
      account: {
        _id: '507f1f77bcf86cd799439011',
        status: accountStatuses.ACTIVE,
        passwordHash,
        passwordSalt,
      },
    });
    accountRepository.appendSession.mockResolvedValue({});
    accountRepository.updateLastLogin.mockResolvedValue({});
    auditPublic.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(authManager.login('admin@example.com', 'valid-password', {
      requestId: 'successful-login-audit',
    })).rejects.toThrow('audit unavailable');
    expect(auditPublic.record).toHaveBeenCalledWith(expect.any(Object), { session });
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test('distinct login attempts cannot collide when a client reuses the request id', async () => {
    accountRepository.findAuthAccountByEmail.mockResolvedValue(null);

    await expect(authManager.login('first@example.com', 'secret', { requestId: 'reused' }))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(authManager.login('second@example.com', 'secret', { requestId: 'reused' }))
      .rejects.toMatchObject({ statusCode: 401 });

    const keys = auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey);
    expect(keys[0]).toMatch(/^auth:login:[a-f0-9]+$/);
    expect(keys[1]).not.toBe(keys[0]);
  });

  test('login resolves an employee code through the HR profile account', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    const accountId = '507f1f77bcf86cd799439011';
    hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValue({
      id: '507f1f77bcf86cd799439099',
      accountId,
      employeeCode: 'J2501',
    });
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: {
        _id: accountId,
        email: 'employee@lng.co',
        passwordHash,
        passwordSalt,
        status: accountStatuses.ACTIVE,
      },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
    accountRepository.appendSession.mockResolvedValue({});
    accountRepository.updateLastLogin.mockResolvedValue({});

    const result = await authManager.login('j2501', 'valid-password');

    expect(result.account.email).toBe('employee@lng.co');
    expect(result.permissions).toEqual(['ORDERS:READ']);
  });

  test('login rejects an employee code that has no HR profile', async () => {
    hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValue(null);
    accountRepository.findAuthAccountByEmail.mockResolvedValue({
      account: { _id: 'should-not-be-used', status: accountStatuses.ACTIVE },
      roles: [],
      permissions: [],
    });

    await expect(authManager.login('J9999', 'valid-password')).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
    });
  });

  test('login returns scoped access assignments when present', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    accountRepository.findAuthAccountByEmail.mockResolvedValue({
      account: {
        _id: '507f1f77bcf86cd799439011',
        email: 'admin@example.com',
        passwordHash,
        passwordSalt,
        status: accountStatuses.ACTIVE,
      },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
      scopes: [
        {
          assignmentId: '507f1f77bcf86cd799439098',
          scopeType: 'global',
          scopeId: null,
          roles: ['OPERATOR'],
          permissions: ['ORDERS:READ'],
        },
        {
          assignmentId: '507f1f77bcf86cd799439099',
          scopeType: 'team',
          scopeId: '507f1f77bcf86cd799439088',
          roles: ['TEAM_LEADER'],
          permissions: ['TEAM_MEMBERS:READ'],
        },
      ],
    });
    accountRepository.appendSession.mockResolvedValue({});
    accountRepository.updateLastLogin.mockResolvedValue({});

    const result = await authManager.login('admin@example.com', 'valid-password');

    expect(result.scopes).toEqual([{
      assignmentId: '507f1f77bcf86cd799439099',
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      resourceId: '507f1f77bcf86cd799439088',
      roles: ['TEAM_LEADER'],
      permissions: ['TEAM_MEMBERS:READ'],
    }]);
  });

  test('getCurrentAccount rejects stale access token versions', async () => {
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: {
        _id: '507f1f77bcf86cd799439011',
        email: 'admin@example.com',
        tokenVersion: 3,
        status: accountStatuses.ACTIVE,
      },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });

    await expect(authManager.getCurrentAccount('507f1f77bcf86cd799439011', 2)).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
    });
  });

  test('refresh rotates token and rejects reused old token after rotation', async () => {
    const account = { _id: '507f1f77bcf86cd799439011' };
    const refreshTokenHash = cryptoUtils.hashString('valid-refresh-token');
    const authModel = {
      account: { _id: account._id, email: 'admin@example.com', status: accountStatuses.ACTIVE },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    };
    accountRepository.findAccountByRefreshToken.mockResolvedValueOnce({
      ...account,
      status: accountStatuses.ACTIVE,
      sessions: [{
        sessionId: 'current-session',
        refreshTokenHash,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        revokedAt: null,
        replacedBySessionId: null,
      }],
    }).mockResolvedValueOnce(null);
    accountRepository.findAuthAccountById.mockResolvedValue(authModel);
    accountRepository.rotateRefreshSession.mockResolvedValue({ _id: account._id });

    const result = await authManager.refreshSession('valid-refresh-token', {
      requestId: 'refresh-request',
      ipAddress: '127.0.0.3',
      userAgent: 'refresh-agent',
    });

    expect(result.refreshToken).toBeTruthy();
    expect(accountRepository.rotateRefreshSession).toHaveBeenCalledTimes(1);
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: account._id,
      action: 'AUTH_SESSION_REFRESHED',
      entityType: 'AUTH_SESSION',
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      requestId: 'refresh-request',
      ipAddress: '127.0.0.3',
      userAgent: 'refresh-agent',
      metadata: {},
      deduplicationKey: expect.stringMatching(/^auth:refresh:[a-f0-9]+$/),
    }), { session });
    expect(JSON.stringify(auditPublic.record.mock.calls[0][0])).not.toContain('valid-refresh-token');

    await expect(authManager.refreshSession('valid-refresh-token', {
      requestId: 'refresh-replay-request',
    })).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
    });
    expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
      actorType: 'ANONYMOUS',
      action: 'AUTH_SESSION_REFRESHED',
      entityType: 'AUTH_SESSION',
      entityId: 'UNKNOWN',
      outcome: 'FAILED',
      metadata: { reason: 'INVALID_REFRESH_TOKEN' },
      deduplicationKey: expect.stringMatching(/^auth:refresh:[a-f0-9]+$/),
    }), {});
  });

  test.each([
    ['ACCOUNT_INACTIVE', accountStatuses.INACTIVE, { _id: 'unused' }],
    ['SESSION_ROTATION_FAILED', accountStatuses.ACTIVE, null],
  ])('refresh audits known-account failure %s without the token', async (reason, status, rotatedAccount) => {
    const accountId = '507f1f77bcf86cd799439011';
    accountRepository.findAccountByRefreshToken.mockResolvedValue({
      _id: accountId,
      status,
      sessions: [{
        sessionId: 'current-session',
        refreshTokenHash: cryptoUtils.hashString('private-refresh-token'),
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        revokedAt: null,
        replacedBySessionId: null,
      }],
    });
    accountRepository.rotateRefreshSession.mockResolvedValue(rotatedAccount);

    await expect(authManager.refreshSession('private-refresh-token', {
      requestId: `refresh-${reason.toLowerCase()}`,
    })).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });

    const event = auditPublic.record.mock.calls[0][0];
    expect(event).toEqual(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: accountId,
      action: 'AUTH_SESSION_REFRESHED',
      entityType: 'AUTH_ACCOUNT',
      entityId: accountId,
      outcome: 'FAILED',
      metadata: { reason },
    }));
    expect(JSON.stringify(event)).not.toMatch(/private-refresh-token|authorization|cookie/i);
  });

  test('refresh audit failure rejects before rotated credentials escape and closes the transaction', async () => {
    const accountId = '507f1f77bcf86cd799439011';
    accountRepository.findAccountByRefreshToken.mockResolvedValue({
      _id: accountId,
      status: accountStatuses.ACTIVE,
      sessions: [{
        sessionId: 'current-session',
        refreshTokenHash: cryptoUtils.hashString('valid-refresh-token'),
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        revokedAt: null,
        replacedBySessionId: null,
      }],
    });
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: { _id: accountId, status: accountStatuses.ACTIVE },
    });
    accountRepository.rotateRefreshSession.mockResolvedValue({ _id: accountId });
    auditPublic.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(authManager.refreshSession('valid-refresh-token', {
      requestId: 'refresh-audit-outage',
    })).rejects.toThrow('audit unavailable');
    expect(accountRepository.rotateRefreshSession).toHaveBeenCalledWith(
      expect.any(String), expect.any(Object), { session },
    );
    expect(auditPublic.record).toHaveBeenCalledWith(expect.any(Object), { session });
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test('refresh replay contains the live successor family and increments tokenVersion', async () => {
    const accountId = '507f1f77bcf86cd799439011';
    const replayedToken = 'replayed-refresh-token';
    accountRepository.findAccountByRefreshToken.mockResolvedValue({
      _id: accountId,
      status: accountStatuses.ACTIVE,
      sessions: [
        {
          sessionId: 'old-session',
          refreshTokenHash: cryptoUtils.hashString(replayedToken),
          revokedAt: new Date(),
          replacedBySessionId: 'live-successor',
        },
        {
          sessionId: 'live-successor',
          refreshTokenHash: 'successor-hash',
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
          revokedAt: null,
          replacedBySessionId: null,
        },
        {
          sessionId: 'independent-session',
          refreshTokenHash: 'independent-hash',
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
          revokedAt: null,
          replacedBySessionId: null,
        },
      ],
    });
    accountRepository.revokeRefreshSessionFamily.mockResolvedValue({ tokenVersion: 4 });

    await expect(authManager.refreshSession(replayedToken, { requestId: 'refresh-replay' }))
      .rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });

    expect(accountRepository.revokeRefreshSessionFamily).toHaveBeenCalledWith(
      accountId,
      ['old-session', 'live-successor'],
      { session },
    );
    const event = auditPublic.record.mock.calls[0][0];
    expect(event).toEqual(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: accountId,
      action: 'AUTH_SESSION_REFRESHED',
      outcome: 'FAILED',
      metadata: { reason: 'REFRESH_TOKEN_REUSED' },
    }));
    expect(auditPublic.record.mock.calls[0][1]).toEqual({});
    expect(JSON.stringify(event)).not.toMatch(/replayed-refresh-token|successor-hash|refreshTokenHash/i);
  });

  test('refresh replay audits once after Mongo finishes retrying containment', async () => {
    const replayedToken = 'replayed-refresh-token';
    session.withTransaction.mockImplementation(async (callback) => {
      await callback();
      await callback();
    });
    accountRepository.findAccountByRefreshToken.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      status: accountStatuses.ACTIVE,
      sessions: [{
        sessionId: 'old-session',
        refreshTokenHash: cryptoUtils.hashString(replayedToken),
        revokedAt: new Date(),
        replacedBySessionId: null,
      }],
    });
    accountRepository.revokeRefreshSessionFamily.mockResolvedValue({ tokenVersion: 4 });

    await expect(authManager.refreshSession(replayedToken, { requestId: 'client-controlled' }))
      .rejects.toMatchObject({ statusCode: 401 });

    const keys = auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^auth:refresh:[a-f0-9]+$/);
  });

  test('refresh replay still returns generic 401 when the best-effort audit is unavailable', async () => {
    const replayedToken = 'replayed-refresh-token';
    accountRepository.findAccountByRefreshToken.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      status: accountStatuses.ACTIVE,
      sessions: [{
        sessionId: 'old-session',
        refreshTokenHash: cryptoUtils.hashString(replayedToken),
        revokedAt: new Date(),
        replacedBySessionId: null,
      }],
    });
    accountRepository.revokeRefreshSessionFamily.mockResolvedValue({ tokenVersion: 4 });
    auditPublic.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(authManager.refreshSession(replayedToken, { requestId: 'refresh-replay-outage' }))
      .rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });

    expect(accountRepository.revokeRefreshSessionFamily).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011', ['old-session'], { session },
    );
    expect(logger.warn).toHaveBeenCalledWith('auth_failure_audit_failed', expect.objectContaining({
      requestId: 'refresh-replay-outage',
    }));
  });

  test('refresh retry does not reuse replay state when the committed attempt finds no token', async () => {
    const replayedToken = 'replayed-refresh-token';
    session.withTransaction.mockImplementation(async (callback) => {
      await callback();
      await callback();
    });
    accountRepository.findAccountByRefreshToken
      .mockResolvedValueOnce({
        _id: '507f1f77bcf86cd799439011',
        status: accountStatuses.ACTIVE,
        sessions: [{
          sessionId: 'old-session',
          refreshTokenHash: cryptoUtils.hashString(replayedToken),
          revokedAt: new Date(),
          replacedBySessionId: null,
        }],
      })
      .mockResolvedValueOnce(null);
    accountRepository.revokeRefreshSessionFamily.mockResolvedValue({ tokenVersion: 4 });

    await expect(authManager.refreshSession(replayedToken, { requestId: 'refresh-branch-retry' }))
      .rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });

    expect(auditPublic.record).toHaveBeenCalledTimes(1);
    expect(auditPublic.record.mock.calls[0][0]).toEqual(expect.objectContaining({
      actorType: 'ANONYMOUS',
      metadata: { reason: 'INVALID_REFRESH_TOKEN' },
    }));
  });

  test('logout audits the resolved account without storing the refresh token', async () => {
    const accountId = '507f1f77bcf86cd799439011';
    accountRepository.revokeRefreshSessionAndReturn.mockResolvedValue({ _id: accountId });

    await authManager.logout('private-refresh-token', {
      requestId: 'logout-request',
      ipAddress: '127.0.0.4',
      userAgent: 'logout-agent',
    });

    const event = auditPublic.record.mock.calls[0][0];
    expect(event).toEqual(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: accountId,
      action: 'AUTH_LOGOUT',
      entityType: 'AUTH_ACCOUNT',
      entityId: accountId,
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      requestId: 'logout-request',
      metadata: {},
      deduplicationKey: expect.stringMatching(/^auth:logout:[a-f0-9]+$/),
    }));
    expect(auditPublic.record.mock.calls[0][1]).toEqual({ session });
    expect(accountRepository.revokeRefreshSessionAndReturn).toHaveBeenCalledWith(
      expect.any(String), { session },
    );
    expect(accountRepository.findAccountByActiveRefreshToken).not.toHaveBeenCalled();
    expect(JSON.stringify(event)).not.toMatch(/private-refresh-token|token|authorization|cookie/i);
  });

  test('logout of a rotated token contains its successor family without false success', async () => {
    const accountId = '507f1f77bcf86cd799439011';
    const replayedToken = 'rotated-refresh-token';
    accountRepository.revokeRefreshSessionAndReturn.mockResolvedValue(null);
    accountRepository.findAccountByRefreshToken.mockResolvedValue({
      _id: accountId,
      sessions: [
        {
          sessionId: 'old-session',
          refreshTokenHash: cryptoUtils.hashString(replayedToken),
          revokedAt: new Date(),
          replacedBySessionId: 'live-successor',
        },
        {
          sessionId: 'live-successor',
          refreshTokenHash: 'successor-hash',
          revokedAt: null,
          replacedBySessionId: null,
        },
      ],
    });
    accountRepository.revokeRefreshSessionFamily.mockResolvedValue({ tokenVersion: 5 });

    await expect(authManager.logout(replayedToken, { requestId: 'logout-replay' }))
      .resolves.toBeUndefined();

    expect(accountRepository.revokeRefreshSessionFamily).toHaveBeenCalledWith(
      accountId, ['old-session', 'live-successor'], { session },
    );
    const event = auditPublic.record.mock.calls[0][0];
    expect(event).toEqual(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: accountId,
      action: 'AUTH_LOGOUT',
      outcome: 'FAILED',
      metadata: { reason: 'REFRESH_TOKEN_REUSED' },
    }));
    expect(JSON.stringify(event)).not.toMatch(/rotated-refresh-token|successor-hash|refreshTokenHash/i);
  });

  test('logout audit failure rejects and closes the transaction', async () => {
    accountRepository.revokeRefreshSessionAndReturn.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
    });
    auditPublic.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(authManager.logout('private-refresh-token', {
      requestId: 'logout-audit-outage',
    })).rejects.toThrow('audit unavailable');
    expect(accountRepository.revokeRefreshSessionAndReturn).toHaveBeenCalledWith(expect.any(String), { session });
    expect(auditPublic.record).toHaveBeenCalledWith(expect.any(Object), { session });
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test('replayed logout remains idempotent when the best-effort audit is unavailable', async () => {
    const replayedToken = 'rotated-refresh-token';
    accountRepository.revokeRefreshSessionAndReturn.mockResolvedValue(null);
    accountRepository.findAccountByRefreshToken.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      sessions: [{
        sessionId: 'old-session',
        refreshTokenHash: cryptoUtils.hashString(replayedToken),
        revokedAt: new Date(),
        replacedBySessionId: null,
      }],
    });
    accountRepository.revokeRefreshSessionFamily.mockResolvedValue({ tokenVersion: 5 });
    auditPublic.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(authManager.logout(replayedToken, { requestId: 'logout-replay-outage' }))
      .resolves.toBeUndefined();

    expect(accountRepository.revokeRefreshSessionFamily).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011', ['old-session'], { session },
    );
    expect(logger.warn).toHaveBeenCalledWith('auth_failure_audit_failed', expect.objectContaining({
      requestId: 'logout-replay-outage',
    }));
  });

  test('logout retry does not reuse revoked state when the committed attempt finds no token', async () => {
    session.withTransaction.mockImplementation(async (callback) => {
      await callback();
      await callback();
    });
    accountRepository.revokeRefreshSessionAndReturn
      .mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' })
      .mockResolvedValueOnce(null);
    accountRepository.findAccountByRefreshToken.mockResolvedValue(null);

    await authManager.logout('private-refresh-token', { requestId: 'logout-branch-retry' });

    expect(auditPublic.record).toHaveBeenCalledTimes(2);
    expect(auditPublic.record.mock.calls[1][0]).toEqual(expect.objectContaining({
      actorType: 'ANONYMOUS',
      outcome: 'FAILED',
      metadata: { reason: 'INVALID_REFRESH_TOKEN' },
    }));
  });

  test('logout reuses its server-owned deduplication key if Mongo retries the transaction', async () => {
    session.withTransaction.mockImplementation(async (callback) => {
      await callback();
      await callback();
    });
    accountRepository.revokeRefreshSessionAndReturn.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
    });

    await authManager.logout('private-refresh-token', { requestId: 'client-controlled' });

    const keys = auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0]).toMatch(/^auth:logout:[a-f0-9]+$/);
  });
});
