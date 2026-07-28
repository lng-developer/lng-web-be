const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Account = require('../../modules/auth/models/account.model');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const accountRepository = require('../../modules/auth/repositories/account.repository');
const auditPublic = require('../../modules/audit/public');
const { accountStatuses } = require('../../modules/auth/constants/auth.constants');

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

  afterEach(async () => Promise.all([Account.deleteMany({}), AuditEvent.deleteMany({})]));

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
});
