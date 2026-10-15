const mongoose = require('mongoose');
const config = require('../../../src/config');
const accountRepository = require('../../../src/modules/auth/repositories/account.repository');
const roleRepository = require('../../../src/modules/auth/repositories/role.repository');
const accessAssignmentRepository = require('../../../src/modules/auth/repositories/accessAssignment.repository');
const hrPublic = require('../../../src/modules/hr/public');
const auditPublic = require('../../../src/modules/audit/public');
const logger = require('../../../src/shared/utils/logger');
const cryptoUtils = require('../../../src/shared/utils/crypto');
const { hashPassword } = cryptoUtils;
const { accountStatuses } = require('../../../src/modules/auth/constants/auth.constants');

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: (...args) => mockVerifyIdToken(...args),
  })),
}));

const authManager = require('../../../src/modules/auth/services/authManager.service');

jest.mock('../../../src/modules/auth/repositories/account.repository');
jest.mock('../../../src/modules/auth/repositories/role.repository');
jest.mock('../../../src/modules/auth/repositories/accessAssignment.repository');
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../../src/shared/utils/logger', () => ({ warn: jest.fn() }));
jest.mock('../../../src/shared/utils/crypto', () => {
  const actual = jest.requireActual('../../../src/shared/utils/crypto');
  return { ...actual, verifyPassword: jest.fn(actual.verifyPassword) };
});
jest.mock('../../../src/modules/hr/public', () => ({
  getEmployeeProfileByEmployeeCode: jest.fn(),
  getEmployeeProfileByAccountId: jest.fn(),
}));

describe('authManager', () => {
  let session;

  beforeEach(() => {
    jest.resetAllMocks();
    auditPublic.record.mockResolvedValue({});
    cryptoUtils.verifyPassword.mockImplementation(
      jest.requireActual('../../../src/shared/utils/crypto').verifyPassword,
    );
    authManager.setGoogleOAuthClient({ verifyIdToken: mockVerifyIdToken });
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

  test('login returns mustChangePassword for a provisioned account', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('123456');
    accountRepository.findAuthAccountByEmail.mockResolvedValue({
      account: {
        _id: '507f1f77bcf86cd799439011',
        email: 'provisioned@example.com',
        passwordHash,
        passwordSalt,
        status: accountStatuses.ACTIVE,
        mustChangePassword: true,
      },
      roles: [],
      permissions: [],
    });
    accountRepository.appendSession.mockResolvedValue({});
    accountRepository.updateLastLogin.mockResolvedValue({});

    await expect(authManager.login('provisioned@example.com', '123456')).resolves.toMatchObject({
      account: { mustChangePassword: true },
    });
  });

  test('changeOwnPassword clears the required flag only after current password verification', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('123456');
    accountRepository.findByIdWithPassword.mockResolvedValue({
      _id: 'account-1',
      passwordHash,
      passwordSalt,
    });
    accountRepository.updatePassword.mockResolvedValue({ _id: 'account-1' });

    await authManager.changeOwnPassword('account-1', {
      currentPassword: '123456',
      newPassword: 'NewStrongPassword1!',
    }, { requestId: 'change-password-request' });

    expect(accountRepository.updatePassword).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({ mustChangePassword: false }),
      expect.objectContaining({
        session,
        expectedPassword: { passwordHash, passwordSalt },
      }),
    );
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: 'account-1',
      action: 'ACCOUNT_PASSWORD_CHANGED',
      entityType: 'AUTH_ACCOUNT',
      entityId: 'account-1',
      outcome: 'SUCCEEDED',
      requestId: 'change-password-request',
    }), expect.anything());
  });

  test.each(['staff@lngwork.co', 'J2501'])('initial LNG password supports subsequent login with %s', async (identifier) => {
    accountRepository.findByIdWithPassword.mockResolvedValue({ _id: 'account-1', status: 'active', microsoftId: 'ms-1' });
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue({ isProfileUpdated: true });
    accountRepository.updatePassword.mockImplementation(async (_id, credentials) => {
      expect(await cryptoUtils.verifyPassword('LNG-password-123', credentials.passwordHash, credentials.passwordSalt)).toBe(true);
      const model = { account: { _id: 'account-1', email: 'staff@lngwork.co', status: 'active', microsoftId: 'ms-1', ...credentials }, roles: ['USER'], permissions: [], scopes: [] };
      accountRepository.findAuthAccountByEmail.mockResolvedValue(model);
      accountRepository.findAuthAccountById.mockResolvedValue(model);
      hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValue({ accountId: 'account-1', employeeCode: 'J2501' });
      return { _id: 'account-1', email: 'staff@lngwork.co', microsoftId: 'ms-1' };
    });
    const result = await authManager.setInitialPassword('account-1', { newPassword: 'LNG-password-123' });
    expect(result.email).toBe('staff@lngwork.co');
    expect(result.passwordSetupRequired).toBe(false);
    expect(accountRepository.updatePassword).toHaveBeenCalledWith('account-1', expect.any(Object), expect.objectContaining({
      session, expectedPassword: { passwordHash: null, passwordSalt: null },
    }));
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACCOUNT_PASSWORD_CREATED' }), { session });
    const login = await authManager.login(identifier, 'LNG-password-123');
    expect(login.account).toMatchObject({ id: 'account-1', email: 'staff@lngwork.co', passwordSetupRequired: false });
    expect(login.roles).toEqual(['USER']);
  });

  test.each([
    null,
    { status: 'inactive', microsoftId: 'ms-1' },
    { status: 'active' },
    { status: 'active', microsoftId: 'ms-1', passwordHash: 'existing', passwordSalt: 'salt' },
  ])('does not initialize credentials for an ineligible account: %j', async (account) => {
    accountRepository.findByIdWithPassword.mockResolvedValue(account);
    await expect(authManager.setInitialPassword('account-1', { newPassword: 'LNG-password-123' })).rejects.toMatchObject({ statusCode: 403 });
    expect(accountRepository.updatePassword).not.toHaveBeenCalled();
  });

  test('requires profile completion before setting an initial password', async () => {
    accountRepository.findByIdWithPassword.mockResolvedValue({ status: 'active', microsoftId: 'ms-1' });
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue({ isProfileUpdated: false });
    await expect(authManager.setInitialPassword('account-1', { newPassword: 'LNG-password-123' })).rejects.toMatchObject({ code: 'ACCOUNT_SETUP_REQUIRED' });
    expect(accountRepository.updatePassword).not.toHaveBeenCalled();
  });

  test('rejects a competing initial password update without recording success', async () => {
    accountRepository.findByIdWithPassword.mockResolvedValue({ status: 'active', microsoftId: 'ms-1' });
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue({ isProfileUpdated: true });
    accountRepository.updatePassword.mockResolvedValue(null);
    await expect(authManager.setInitialPassword('account-1', { newPassword: 'LNG-password-123' })).rejects.toMatchObject({ statusCode: 409 });
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('passwordless Microsoft accounts fail local login as invalid credentials, not a crypto error', async () => {
    accountRepository.findAuthAccountByEmail.mockResolvedValue({ account: { _id: 'account-1', status: 'active', microsoftId: 'ms-1' }, roles: [], permissions: [] });
    await expect(authManager.login('staff@lngwork.co', 'incorrect')).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passwordless Microsoft accounts cannot use the existing-password change endpoint', async () => {
    accountRepository.findByIdWithPassword.mockResolvedValue({ status: 'active', microsoftId: 'ms-1' });
    await expect(authManager.changeOwnPassword('account-1', { currentPassword: 'anything', newPassword: 'LNG-password-123' })).rejects.toMatchObject({ statusCode: 401 });
    expect(accountRepository.updatePassword).not.toHaveBeenCalled();
  });

  test('changeOwnPassword rejects when the account disappears before its password update', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('123456');
    accountRepository.findByIdWithPassword.mockResolvedValue({
      _id: 'account-1',
      passwordHash,
      passwordSalt,
    });
    accountRepository.updatePassword.mockResolvedValue(null);

    await expect(authManager.changeOwnPassword('account-1', {
      currentPassword: '123456',
      newPassword: 'NewStrongPassword1!',
    })).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });

    expect(auditPublic.record).not.toHaveBeenCalled();
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
    expect(accountRepository.findAuthAccountById).toHaveBeenCalledWith(accountId, {
      includePassword: true,
    });
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
    expect(auditPublic.record).not.toHaveBeenCalled();

    await expect(authManager.refreshSession('valid-refresh-token', {
      requestId: 'refresh-replay-request',
    })).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_ERROR',
    });
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
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

  test('refresh succeeds when audit storage is unavailable because successful refreshes are not audited', async () => {
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
    })).resolves.toMatchObject({ refreshToken: expect.any(String) });
    expect(accountRepository.rotateRefreshSession).toHaveBeenCalledWith(
      expect.any(String), expect.any(Object), { session },
    );
    expect(auditPublic.record).not.toHaveBeenCalled();
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

  describe('loginWithGoogle', () => {
    test('authenticates existing account matched by googleId', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'user@example.com',
          email_verified: true,
          sub: 'google-sub-123',
        }),
      });

      const existingAuthModel = {
        account: {
          _id: '507f1f77bcf86cd799439011',
          email: 'user@example.com',
          status: accountStatuses.ACTIVE,
          tokenVersion: 1,
        },
        roles: ['OPERATOR'],
        permissions: ['ORDERS:READ'],
        scopes: [],
      };

      accountRepository.findAuthAccountByGoogleId.mockResolvedValue(existingAuthModel);
      accountRepository.appendSession.mockResolvedValue({});
      accountRepository.updateLastLogin.mockResolvedValue({});

      const response = await authManager.loginWithGoogle('valid-token', {
        requestId: 'google-req-1',
        ipAddress: '10.0.0.1',
      });

      expect(response).toHaveProperty('accessToken');
      expect(response).toHaveProperty('refreshToken');
      expect(response.account.email).toBe('user@example.com');
      expect(accountRepository.appendSession).toHaveBeenCalled();
      expect(auditPublic.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGIN_SUCCEEDED',
          metadata: expect.objectContaining({ provider: 'GOOGLE', googleId: 'google-sub-123' }),
        }),
        expect.any(Object),
      );
    });

    test('links googleId when existing account is matched by email', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'existing@example.com',
          email_verified: true,
          sub: 'google-sub-456',
          picture: 'https://example.com/avatar.jpg',
        }),
      });

      const existingAuthModel = {
        account: {
          _id: '507f1f77bcf86cd799439022',
          email: 'existing@example.com',
          status: accountStatuses.ACTIVE,
          tokenVersion: 0,
        },
        roles: ['OPERATOR'],
        permissions: ['ORDERS:READ'],
        scopes: [],
      };

      accountRepository.findAuthAccountByGoogleId.mockResolvedValue(null);
      accountRepository.findAuthAccountByEmail.mockResolvedValue(existingAuthModel);
      accountRepository.linkGoogleAccount.mockResolvedValue({});
      accountRepository.findAuthAccountById.mockResolvedValue({
        ...existingAuthModel,
        account: {
          ...existingAuthModel.account,
          googleId: 'google-sub-456',
          avatarUrl: 'https://example.com/avatar.jpg',
        },
      });
      accountRepository.appendSession.mockResolvedValue({});
      accountRepository.updateLastLogin.mockResolvedValue({});

      const response = await authManager.loginWithGoogle('valid-token');

      expect(accountRepository.linkGoogleAccount).toHaveBeenCalledWith('507f1f77bcf86cd799439022', {
        googleId: 'google-sub-456',
        avatarUrl: 'https://example.com/avatar.jpg',
      });
      expect(response.account.email).toBe('existing@example.com');
    });

    test('rejects when account does not exist and registration is disabled', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'unknown@example.com',
          email_verified: true,
          sub: 'google-sub-999',
        }),
      });

      accountRepository.findAuthAccountByGoogleId.mockResolvedValue(null);
      accountRepository.findAuthAccountByEmail.mockResolvedValue(null);

      await expect(authManager.loginWithGoogle('valid-token')).rejects.toThrow(
        'Tài khoản chưa được kích hoạt trên hệ thống. Vui lòng liên hệ quản trị viên.',
      );

      expect(auditPublic.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGIN_FAILED',
          outcome: 'FAILED',
          metadata: expect.objectContaining({ reason: 'ACCOUNT_NOT_FOUND', provider: 'GOOGLE' }),
        }),
        expect.any(Object),
      );
    });

    test('rejects unverified Google email', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'unverified@example.com',
          email_verified: false,
          sub: 'google-sub-000',
        }),
      });

      await expect(authManager.loginWithGoogle('unverified-token')).rejects.toThrow(
        'Email Google chưa được xác thực',
      );
    });

    test('rejects invalid Google ID token', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

      await expect(authManager.loginWithGoogle('bad-token')).rejects.toThrow(
        'Xác thực tài khoản Google không hợp lệ hoặc đã hết hạn',
      );
    });
  });

  describe('loginWithMicrosoft', () => {
    test('authenticates existing account matched by microsoftId with @lngwork.co domain', async () => {
      authManager.setMicrosoftTokenVerifier(jest.fn().mockResolvedValue({
        preferred_username: 'employee@lngwork.co',
        oid: 'ms-oid-123',
      }));

      const existingAuthModel = {
        account: {
          _id: '507f1f77bcf86cd799439033',
          email: 'employee@lngwork.co',
          status: accountStatuses.ACTIVE,
          tokenVersion: 1,
        },
        roles: ['OPERATOR'],
        permissions: ['ORDERS:READ'],
        scopes: [],
      };

      accountRepository.findAuthAccountByMicrosoftId.mockResolvedValue(existingAuthModel);
      accountRepository.appendSession.mockResolvedValue({});
      accountRepository.updateLastLogin.mockResolvedValue({});

      const response = await authManager.loginWithMicrosoft('valid-ms-token', {
        requestId: 'ms-req-1',
        ipAddress: '10.0.0.2',
      });

      expect(response).toHaveProperty('accessToken');
      expect(response).toHaveProperty('refreshToken');
      expect(response.account.email).toBe('employee@lngwork.co');
      expect(accountRepository.appendSession).toHaveBeenCalled();
      expect(auditPublic.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGIN_SUCCEEDED',
          metadata: expect.objectContaining({ provider: 'MICROSOFT', microsoftId: 'ms-oid-123' }),
        }),
        expect.any(Object),
      );
    });

    test('links microsoftId when existing account is matched by email', async () => {
      authManager.setMicrosoftTokenVerifier(jest.fn().mockResolvedValue({
        email: 'staff@lngwork.co',
        oid: 'ms-oid-456',
        picture: 'https://example.com/ms-avatar.jpg',
      }));

      const existingAuthModel = {
        account: {
          _id: '507f1f77bcf86cd799439044',
          email: 'staff@lngwork.co',
          status: accountStatuses.ACTIVE,
          tokenVersion: 0,
        },
        roles: ['OPERATOR'],
        permissions: ['ORDERS:READ'],
        scopes: [],
      };

      accountRepository.findAuthAccountByMicrosoftId.mockResolvedValue(null);
      accountRepository.findAuthAccountByEmail.mockResolvedValue(existingAuthModel);
      accountRepository.linkMicrosoftAccount.mockResolvedValue({});
      accountRepository.findAuthAccountById.mockResolvedValue({
        ...existingAuthModel,
        account: {
          ...existingAuthModel.account,
          microsoftId: 'ms-oid-456',
          avatarUrl: 'https://example.com/ms-avatar.jpg',
        },
      });
      accountRepository.appendSession.mockResolvedValue({});
      accountRepository.updateLastLogin.mockResolvedValue({});

      const response = await authManager.loginWithMicrosoft('valid-ms-token');

      expect(accountRepository.linkMicrosoftAccount).toHaveBeenCalledWith('507f1f77bcf86cd799439044', {
        microsoftId: 'ms-oid-456',
        avatarUrl: 'https://example.com/ms-avatar.jpg',
      });
      expect(response.account.email).toBe('staff@lngwork.co');
    });

    test('rejects email not belonging to allowed domain (@lngwork.co)', async () => {
      authManager.setMicrosoftTokenVerifier(jest.fn().mockResolvedValue({
        preferred_username: 'outsider@gmail.com',
        oid: 'ms-oid-999',
      }));

      await expect(authManager.loginWithMicrosoft('valid-token-wrong-domain')).rejects.toThrow(
        'Chỉ cho phép tài khoản Microsoft thuộc tổ chức @lngwork.co',
      );

      expect(auditPublic.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGIN_FAILED',
          outcome: 'FAILED',
          metadata: expect.objectContaining({ reason: 'DOMAIN_NOT_ALLOWED', provider: 'MICROSOFT' }),
        }),
        expect.any(Object),
      );
    });

    test('rejects when account does not exist and registration & auto-provision are disabled', async () => {
      const prevAutoProvision = config.auth.microsoftAutoProvision;
      config.auth.microsoftAutoProvision = false;
      try {
        authManager.setMicrosoftTokenVerifier(jest.fn().mockResolvedValue({
          preferred_username: 'newhire@lngwork.co',
          oid: 'ms-oid-888',
        }));

        accountRepository.findAuthAccountByMicrosoftId.mockResolvedValue(null);
        accountRepository.findAuthAccountByEmail.mockResolvedValue(null);

        await expect(authManager.loginWithMicrosoft('valid-token')).rejects.toThrow(
          'Tài khoản chưa được kích hoạt trên hệ thống. Vui lòng liên hệ quản trị viên.',
        );
      } finally {
        config.auth.microsoftAutoProvision = prevAutoProvision;
      }
    });

    test('auto-provisions new account with USER role when microsoftAutoProvision is enabled', async () => {
      authManager.setMicrosoftTokenVerifier(jest.fn().mockResolvedValue({
        preferred_username: 'autohire@lngwork.co',
        oid: 'ms-oid-999',
      }));

      accountRepository.findAuthAccountByMicrosoftId.mockResolvedValue(null);
      accountRepository.findAuthAccountByEmail.mockResolvedValue(null);

      const createdAccount = {
        _id: '507f1f77bcf86cd799439099',
        email: 'autohire@lngwork.co',
        status: accountStatuses.ACTIVE,
        tokenVersion: 1,
      };
      const createdAuthModel = {
        account: createdAccount,
        roles: ['USER'],
        permissions: [],
        scopes: [],
      };

      roleRepository.findByCode.mockResolvedValue({ _id: 'role-user-id', code: 'USER' });
      accountRepository.create.mockResolvedValue(createdAccount);
      accessAssignmentRepository.create.mockResolvedValue({});
      accountRepository.findAuthAccountById.mockResolvedValue(createdAuthModel);
      accountRepository.appendSession.mockResolvedValue({});
      accountRepository.updateLastLogin.mockResolvedValue({});

      const response = await authManager.loginWithMicrosoft('valid-token');
      expect(response).toHaveProperty('accessToken');
      expect(response.account.email).toBe('autohire@lngwork.co');
      expect(accountRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'autohire@lngwork.co',
          microsoftId: 'ms-oid-999',
          authProvider: 'MICROSOFT',
        }),
        expect.any(Object),
      );
    });

    test('rejects invalid Microsoft ID token', async () => {
      authManager.setMicrosoftTokenVerifier(jest.fn().mockRejectedValue(new Error('Invalid signature')));

      await expect(authManager.loginWithMicrosoft('bad-ms-token')).rejects.toThrow(
        'Xác thực tài khoản Microsoft không hợp lệ hoặc đã hết hạn',
      );
    });
  });
});
