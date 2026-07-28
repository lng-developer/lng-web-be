const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Account = require('../../modules/auth/models/account.model');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const accountRepository = require('../../modules/auth/repositories/account.repository');
const auditPublic = require('../../modules/audit/public');
const authManager = require('../../modules/auth/services/authManager.service');
const { accountStatuses } = require('../../modules/auth/constants/auth.constants');
const { hashPassword, hashString } = require('../../shared/utils/crypto');

let database;
jest.setTimeout(120000);

function refreshSession() {
  return {
    sessionId: 'original-session',
    refreshTokenHash: 'original-refresh-hash',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    revokedAt: null,
    replacedBySessionId: null,
  };
}

async function abortOnAuditFailure(mutate) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await mutate(session);
      await auditPublic.record({ actorType: 'INVALID' }, { session });
    });
  } finally {
    await session.endSession();
  }
}

describe('auth session audit transactions', () => {
  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri('lng_web_be_auth_audit_test'));
    await Promise.all([Account.init(), AuditEvent.init()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([Account.deleteMany({}), AuditEvent.deleteMany({})]);
  });

  test.each([
    ['login session creation', async (account, session) => {
      await accountRepository.appendSession(account._id, refreshSession(), { session });
      await accountRepository.updateLastLogin(account._id, '127.0.0.1', { session });
    }],
    ['refresh rotation', async (_account, session) => {
      await accountRepository.rotateRefreshSession('original-refresh-hash', {
        ...refreshSession(),
        sessionId: 'replacement-session',
        refreshTokenHash: 'replacement-refresh-hash',
      }, { session });
    }],
    ['logout revocation', async (_account, session) => {
      await accountRepository.revokeRefreshSession('original-refresh-hash', { session });
    }],
  ])('rolls back %s when its audit write fails', async (_name, mutate) => {
    const account = await Account.create({
      email: 'operator@lng.co',
      passwordHash: 'hash',
      passwordSalt: 'salt',
      status: accountStatuses.ACTIVE,
      sessions: _name === 'login session creation' ? [] : [refreshSession()],
    });

    await expect(abortOnAuditFailure((session) => mutate(account, session))).rejects.toThrow();

    const persisted = await Account.findById(account._id).lean();
    if (_name === 'login session creation') {
      expect(persisted.sessions).toHaveLength(0);
      expect(persisted.lastLoginAt).toBeNull();
    } else {
      expect(persisted.sessions).toHaveLength(1);
      expect(persisted.sessions[0]).toMatchObject({
        sessionId: 'original-session',
        revokedAt: null,
        replacedBySessionId: null,
      });
    }
    await expect(AuditEvent.countDocuments({})).resolves.toBe(0);
  });

  test('refresh replay revokes only its live successor family and invalidates access tokens', async () => {
    const originalToken = 'original-private-token';
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    const account = await Account.create({
      email: 'refresh.operator@lng.co',
      passwordHash,
      passwordSalt,
      status: accountStatuses.ACTIVE,
      sessions: [{
        ...refreshSession(),
        refreshTokenHash: hashString(originalToken),
      }, {
        ...refreshSession(),
        sessionId: 'independent-session',
        refreshTokenHash: hashString('independent-private-token'),
      }],
    });

    const rotated = await authManager.refreshSession(originalToken, { requestId: 'real-refresh' });
    const accessPayload = authManager.verifyAccessToken(rotated.accessToken);
    await expect(authManager.refreshSession(originalToken, { requestId: 'real-replay' }))
      .rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });

    const persisted = await Account.findById(account._id).lean();
    const original = persisted.sessions.find((entry) => entry.sessionId === 'original-session');
    const successor = persisted.sessions.find((entry) => entry.sessionId === original.replacedBySessionId);
    const independent = persisted.sessions.find((entry) => entry.sessionId === 'independent-session');
    expect(original.revokedAt).toBeInstanceOf(Date);
    expect(successor.revokedAt).toBeInstanceOf(Date);
    expect(independent.revokedAt).toBeNull();
    expect(persisted.tokenVersion).toBe(1);
    await expect(authManager.getCurrentAccount(account._id, accessPayload.tokenVersion))
      .rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });

    const events = await AuditEvent.find({}).lean();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'AUTH_SESSION_REFRESHED', outcome: 'SUCCEEDED' }),
      expect.objectContaining({
        actorType: 'ACCOUNT',
        actorAccountId: account._id,
        action: 'AUTH_SESSION_REFRESHED',
        outcome: 'FAILED',
        metadata: { reason: 'REFRESH_TOKEN_REUSED' },
      }),
    ]));
    expect(JSON.stringify(events)).not.toMatch(/original-private-token|independent-private-token/);
  });

  test('refresh signs the transaction tokenVersion when replay containment lands before signing', async () => {
    const originalToken = 'interposed-original-token';
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    const account = await Account.create({
      email: 'interposed.refresh@lng.co',
      passwordHash,
      passwordSalt,
      status: accountStatuses.ACTIVE,
      sessions: [{
        ...refreshSession(),
        refreshTokenHash: hashString(originalToken),
      }],
    });
    const findAuthAccountById = accountRepository.findAuthAccountById;
    jest.spyOn(accountRepository, 'findAuthAccountById').mockImplementationOnce(async (accountId) => {
      await expect(authManager.refreshSession(originalToken, { requestId: 'interposed-replay' }))
        .rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });
      return findAuthAccountById(accountId);
    });

    const rotated = await authManager.refreshSession(originalToken, {
      requestId: 'interposed-rotation',
    });
    const accessPayload = authManager.verifyAccessToken(rotated.accessToken);
    const persisted = await Account.findById(account._id).lean();
    const original = persisted.sessions.find((entry) => entry.sessionId === 'original-session');
    const successor = persisted.sessions.find((entry) => entry.sessionId === original.replacedBySessionId);

    expect(persisted.tokenVersion).toBe(1);
    expect(successor.revokedAt).toBeInstanceOf(Date);
    expect(accessPayload.tokenVersion).toBe(0);
    await expect(authManager.getCurrentAccount(account._id, accessPayload.tokenVersion))
      .rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_ERROR' });
  });

  test('concurrent logout calls record one real success and contain the replay', async () => {
    const logoutToken = 'logout-private-token';
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    const account = await Account.create({
      email: 'logout.operator@lng.co',
      passwordHash,
      passwordSalt,
      status: accountStatuses.ACTIVE,
      sessions: [{
        ...refreshSession(),
        refreshTokenHash: hashString(logoutToken),
      }],
    });

    await expect(Promise.all([
      authManager.logout(logoutToken, { requestId: 'logout-race-one' }),
      authManager.logout(logoutToken, { requestId: 'logout-race-two' }),
    ])).resolves.toEqual([undefined, undefined]);

    const persisted = await Account.findById(account._id).lean();
    expect(persisted.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(persisted.tokenVersion).toBe(1);
    const events = await AuditEvent.find({ action: 'AUTH_LOGOUT' }).lean();
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.outcome).sort()).toEqual(['FAILED', 'SUCCEEDED']);
    expect(events.find((event) => event.outcome === 'FAILED')).toMatchObject({
      actorType: 'ACCOUNT',
      actorAccountId: account._id,
      metadata: { reason: 'REFRESH_TOKEN_REUSED' },
    });
    expect(JSON.stringify(events)).not.toContain(logoutToken);
  });

  test('authManager transaction rolls back on audit failure then retries with one deduplicated event', async () => {
    const { passwordHash, passwordSalt } = await hashPassword('valid-password');
    const account = await Account.create({
      email: 'login.operator@lng.co',
      passwordHash,
      passwordSalt,
      status: accountStatuses.ACTIVE,
      sessions: [],
    });
    const realRecord = auditPublic.record;
    jest.spyOn(auditPublic, 'record').mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(authManager.login('login.operator@lng.co', 'valid-password', {
      requestId: 'real-login-rollback',
    })).rejects.toThrow('audit unavailable');
    await expect(Account.findById(account._id).lean()).resolves.toMatchObject({ sessions: [] });
    await expect(AuditEvent.countDocuments({})).resolves.toBe(0);

    auditPublic.record.mockRestore();
    let attempts = 0;
    jest.spyOn(auditPublic, 'record').mockImplementation(async (payload, options) => {
      const recorded = await realRecord(payload, options);
      await realRecord(payload, options);
      attempts += 1;
      if (attempts === 1) {
        const error = new mongoose.mongo.MongoServerError({ message: 'retry transaction' });
        error.addErrorLabel('TransientTransactionError');
        throw error;
      }
      return recorded;
    });

    await expect(authManager.login('login.operator@lng.co', 'valid-password', {
      requestId: 'real-login-retry',
    })).resolves.toHaveProperty('refreshToken');

    expect(attempts).toBe(2);
    await expect(Account.findById(account._id).lean()).resolves.toMatchObject({
      sessions: [expect.objectContaining({ revokedAt: null })],
    });
    await expect(AuditEvent.countDocuments({ action: 'AUTH_LOGIN_SUCCEEDED' })).resolves.toBe(1);
  });
});
