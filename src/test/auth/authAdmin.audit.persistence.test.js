process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Account = require('../../modules/auth/models/account.model');
const Role = require('../../modules/auth/models/role.model');
const Permission = require('../../modules/auth/models/permission.model');
const AccessAssignment = require('../../modules/auth/models/accessAssignment.model');
const ScopeRegistry = require('../../modules/auth/models/scopeRegistry.model');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const auditPublic = require('../../modules/audit/public');
const authAdmin = require('../../modules/auth/services/authAdmin.service');
const authManager = require('../../modules/auth/services/authManager.service');
const auditEventService = require('../../modules/audit/services/auditEvent.service');
const { accountStatuses } = require('../../modules/auth/constants/auth.constants');

let database;
jest.setTimeout(120000);

describe('auth administration audit transactions', () => {
  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri('lng_web_be_auth_admin_audit_test'));
    await Promise.all([
      Account.init(), Role.init(), Permission.init(), AccessAssignment.init(),
      ScopeRegistry.init(), AuditEvent.init(),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  beforeEach(() => {
    jest.spyOn(authManager, 'invalidatePermissionCache').mockResolvedValue();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([
      Account.deleteMany({}), Role.deleteMany({}), Permission.deleteMany({}),
      AccessAssignment.deleteMany({}), ScopeRegistry.deleteMany({}), AuditEvent.deleteMany({}),
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

  test('unchanged account status preserves timestamps and records a no-op', async () => {
    const account = await Account.create({
      email: 'status-noop@lng.co', passwordHash: 'hash', passwordSalt: 'salt', status: accountStatuses.ACTIVE,
    });
    const updatedAt = account.updatedAt.getTime();

    await authAdmin.updateAccountStatus(account._id, accountStatuses.ACTIVE);

    const persisted = await Account.findById(account._id).lean();
    expect(persisted.updatedAt.getTime()).toBe(updatedAt);
    expect(authManager.invalidatePermissionCache).not.toHaveBeenCalled();
    await expect(AuditEvent.findOne({ action: 'ACCOUNT_STATUS_UPDATED' }).lean()).resolves.toMatchObject({
      changes: {}, metadata: { noOp: true },
    });
  });

  test('concurrent identical role-permission adds record one mutation and one truthful no-op', async () => {
    const permission = await Permission.create({ code: 'ORDERS:READ', name: 'Read orders' });
    const role = await Role.create({ code: 'OPERATOR', name: 'Operator', permissions: [] });

    const results = await Promise.allSettled([
      authAdmin.addRolePermission(role._id, permission._id),
      authAdmin.addRolePermission(role._id, permission._id),
    ]);

    const rejected = results.find(({ status }) => status === 'rejected');
    if (rejected) throw rejected.reason;
    const persisted = await Role.findById(role._id).lean();
    expect(persisted.permissions.map(String)).toEqual([String(permission._id)]);
    const events = await AuditEvent.find({ action: 'ROLE_PERMISSION_ADDED' }).lean();
    expect(events.map(({ metadata }) => metadata.noOp).sort()).toEqual([false, true]);
  });

  test('scope deactivation racing assignment creation cannot leave active access on an inactive scope', async () => {
    const account = await Account.create({
      email: 'scope-race@lng.co', passwordHash: 'hash', passwordSalt: 'salt', status: accountStatuses.ACTIVE,
    });
    const role = await Role.create({ code: 'SCOPE_RACE', name: 'Scope race', permissions: [] });
    const scopeId = new mongoose.Types.ObjectId();
    const scope = await ScopeRegistry.create({ scopeType: 'team', scopeId, name: 'Race team', status: 'active' });

    const results = await Promise.allSettled([
      authAdmin.createAccessAssignment({
        accountId: account._id, roleId: role._id, scopeType: 'team', scopeId, customPermissions: [],
      }),
      authAdmin.deactivateScope(scope._id),
    ]);

    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const [persistedScope, activeAssignments] = await Promise.all([
      ScopeRegistry.findById(scope._id).lean(),
      AccessAssignment.countDocuments({ scopeType: 'team', scopeId, status: 'active' }),
    ]);
    expect(persistedScope.status === 'inactive' && activeAssignments > 0).toBe(false);
  });

  test('role deletion racing assignment creation cannot leave a dangling role id', async () => {
    const account = await Account.create({
      email: 'role-race@lng.co', passwordHash: 'hash', passwordSalt: 'salt', status: accountStatuses.ACTIVE,
    });
    const role = await Role.create({ code: 'DELETE_RACE', name: 'Delete race', permissions: [] });

    await Promise.allSettled([
      authAdmin.createAccessAssignment({
        accountId: account._id, roleId: role._id, scopeType: 'global', scopeId: null, customPermissions: [],
      }),
      authAdmin.deleteRole(role._id),
    ]);

    const [persistedRole, danglingAssignments] = await Promise.all([
      Role.exists({ _id: role._id }), AccessAssignment.countDocuments({ roleId: role._id }),
    ]);
    expect(Boolean(persistedRole) || danglingAssignments === 0).toBe(true);
  });

  test('permission deletion racing role attachment cannot leave a dangling permission id', async () => {
    const permission = await Permission.create({ code: 'DELETE:RACE', name: 'Delete race' });
    const role = await Role.create({ code: 'PERMISSION_RACE', name: 'Permission race', permissions: [] });

    await Promise.allSettled([
      authAdmin.addRolePermission(role._id, permission._id),
      authAdmin.deletePermission(permission._id),
    ]);

    const [persistedPermission, persistedRole] = await Promise.all([
      Permission.exists({ _id: permission._id }), Role.findById(role._id).lean(),
    ]);
    const attached = persistedRole.permissions.some((id) => String(id) === String(permission._id));
    expect(Boolean(persistedPermission) || !attached).toBe(true);
  });

  test('assignment scope move is readable by auditors of both old and new scopes', async () => {
    const account = await Account.create({
      email: 'scope-move@lng.co', passwordHash: 'hash', passwordSalt: 'salt', status: accountStatuses.ACTIVE,
    });
    const role = await Role.create({ code: 'SCOPE_MOVE', name: 'Scope move', permissions: [] });
    const oldScopeId = new mongoose.Types.ObjectId();
    const newScopeId = new mongoose.Types.ObjectId();
    await ScopeRegistry.create([
      { scopeType: 'team', scopeId: oldScopeId, name: 'Old team', status: 'active' },
      { scopeType: 'team', scopeId: newScopeId, name: 'New team', status: 'active' },
    ]);
    const assignment = await AccessAssignment.create({
      accountId: account._id, roleId: role._id, scopeType: 'team', scopeId: oldScopeId,
      customPermissions: [], status: 'active',
    });

    await authAdmin.updateAccessAssignment(assignment._id, { scopeType: 'team', scopeId: newScopeId });

    const reader = (scopeId) => ({
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId, permissions: ['AUDIT:READ'] }],
    });
    const [oldEvents, newEvents] = await Promise.all([
      auditEventService.listEvents({ entityId: String(assignment._id), limit: 20 }, reader(oldScopeId)),
      auditEventService.listEvents({ entityId: String(assignment._id), limit: 20 }, reader(newScopeId)),
    ]);
    expect(oldEvents.items.map(({ action }) => action)).toContain('ACCESS_ASSIGNMENT_SCOPE_MOVED_FROM');
    expect(newEvents.items.map(({ action }) => action)).toContain('ACCESS_ASSIGNMENT_SCOPE_MOVED_TO');
  });
});
