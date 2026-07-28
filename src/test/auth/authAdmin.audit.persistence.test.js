const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Account = require('../../modules/auth/models/account.model');
const Role = require('../../modules/auth/models/role.model');
const ScopeRegistry = require('../../modules/auth/models/scopeRegistry.model');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const auditPublic = require('../../modules/audit/public');
const authAdmin = require('../../modules/auth/services/authAdmin.service');
const { accountStatuses } = require('../../modules/auth/constants/auth.constants');

let database;
jest.setTimeout(120000);

describe('auth administration audit transactions', () => {
  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri('lng_web_be_auth_admin_audit_test'));
    await Promise.all([Account.init(), Role.init(), ScopeRegistry.init(), AuditEvent.init()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([
      Account.deleteMany({}), Role.deleteMany({}), ScopeRegistry.deleteMany({}), AuditEvent.deleteMany({}),
    ]);
  });

  test('rolls back an account mutation when its audit write fails', async () => {
    const account = await Account.create({
      email: 'rollback-account@lng.co', passwordHash: 'hash', passwordSalt: 'salt', status: 'active',
    });
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(authAdmin.updateAccountStatus(account._id, 'inactive'))
      .rejects.toThrow('audit unavailable');

    await expect(Account.findById(account._id).lean()).resolves.toMatchObject({ status: 'active' });
    await expect(AuditEvent.countDocuments({})).resolves.toBe(0);
  });

  test('rolls back an RBAC mutation when its audit write fails', async () => {
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(authAdmin.createRole({ code: 'ROLLBACK_ROLE', name: 'Rollback role', permissions: [] }))
      .rejects.toThrow('audit unavailable');

    await expect(Role.countDocuments({ code: 'ROLLBACK_ROLE' })).resolves.toBe(0);
    await expect(AuditEvent.countDocuments({})).resolves.toBe(0);
  });

  test('rolls back a programmatic scope sync when its audit write fails', async () => {
    const scopeId = new mongoose.Types.ObjectId();
    await ScopeRegistry.create({ scopeType: 'team', scopeId, name: 'Before', status: 'active' });
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(authAdmin.syncScopeRegistry({
      scopeType: 'team', scopeId, name: 'After', status: 'inactive',
    })).rejects.toThrow('audit unavailable');

    await expect(ScopeRegistry.findOne({ scopeType: 'team', scopeId }).lean()).resolves.toMatchObject({
      name: 'Before', status: 'active',
    });
    await expect(AuditEvent.countDocuments({})).resolves.toBe(0);
  });

  test.each([
    ['unchanged email', accountStatuses.ACTIVE, (account) => (
      authAdmin.updateAccountEmail(account._id, ' NOOP@LNG.CO ')
    ), 'ACCOUNT_EMAIL_UPDATED'],
    ['already archived account', accountStatuses.ARCHIVED, (account) => (
      authAdmin.archiveAccount(account._id)
    ), 'ACCOUNT_ARCHIVED'],
  ])('%s preserves tokenVersion and active sessions while recording an audited no-op', async (
    _name, status, invoke, action,
  ) => {
    const expiresAt = new Date(Date.now() + 60_000);
    const account = await Account.create({
      email: 'noop@lng.co', passwordHash: 'hash', passwordSalt: 'salt', status, tokenVersion: 7,
      sessions: [{
        sessionId: 'noop-session', refreshTokenHash: 'noop-hash', expiresAt, revokedAt: null,
      }],
    });

    await invoke(account);

    const persisted = await Account.findById(account._id).lean();
    expect(persisted.tokenVersion).toBe(7);
    expect(persisted.sessions).toHaveLength(1);
    expect(persisted.sessions[0]).toMatchObject({ sessionId: 'noop-session', revokedAt: null });
    await expect(AuditEvent.findOne({ action }).lean()).resolves.toMatchObject({
      actorType: 'SYSTEM', source: 'SYSTEM', outcome: 'SUCCEEDED', metadata: { noOp: true },
    });
  });
});
