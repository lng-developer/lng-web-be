const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Account = require('../../../modules/auth/models/account.model');
const AccessAssignment = require('../../../modules/auth/models/accessAssignment.model');
const Permission = require('../../../modules/auth/models/permission.model');
const Role = require('../../../modules/auth/models/role.model');
const UserProfile = require('../../../modules/auth/models/userProfile.model');
const authMigration = require('../../../modules/auth/services/authMigration.service');

describe('authMigration service', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ dbName: 'auth_migration_test' }] });
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Account.deleteMany({}),
      AccessAssignment.deleteMany({}),
      Permission.deleteMany({}),
      Role.deleteMany({}),
      UserProfile.deleteMany({}),
    ]);
    const permission = await Permission.create({ code: 'HR_EMPLOYEES:READ', name: 'Read employees' });
    await Role.create({ code: 'MANAGER', name: 'Manager', permissions: [permission._id] });
  });

  function identity() {
    return {
      sourceId: '660000000000000000000201',
      sourceAccountId: '660000000000000000000101',
      accountId: '660000000000000000000101',
      email: 'hr@example.com',
      fullName: 'HR User',
      employeeCode: 'NV001',
      phone: '0900000000',
      isActiveOrProbation: true,
      roleDecision: {
        legacyRole: 'HR',
        assignments: [{
          roleCode: 'MANAGER',
          scopeType: 'global',
          scopeId: null,
          overridePermissionCodes: ['HR_EMPLOYEES:READ'],
        }],
        elevated: false,
      },
    };
  }

  it('validates a dry-run without persisting accounts, profiles, or assignments', async () => {
    const result = await authMigration.migrateLegacyIdentities([identity()], { apply: false });

    expect(result).toMatchObject({ read: 1, mapped: 1, skipped: 0, failed: 0 });
    expect(result.items).toEqual([expect.objectContaining({ outcome: 'WOULD_CREATE' })]);
    await expect(Account.countDocuments()).resolves.toBe(0);
    await expect(UserProfile.countDocuments()).resolves.toBe(0);
    await expect(AccessAssignment.countDocuments()).resolves.toBe(0);
  });

  it('creates an inactive identity with scoped RBAC once and keeps the second pass unchanged', async () => {
    const first = await authMigration.migrateLegacyIdentities([identity()], { apply: true });
    const account = await Account.findOne({ normalizedEmail: 'hr@example.com' }).select('+passwordHash +passwordSalt').lean();
    const profile = await UserProfile.findOne({ accountId: account._id }).lean();
    const assignments = await AccessAssignment.find({ accountId: account._id }).lean();

    expect(first).toMatchObject({ read: 1, mapped: 1, inserted: 1, skipped: 0, failed: 0 });
    expect(account).toMatchObject({ status: 'inactive', tokenVersion: 0, sessions: [] });
    expect(account.passwordHash).toHaveLength(128);
    expect(account.passwordSalt).toHaveLength(32);
    expect(profile).toMatchObject({ email: 'hr@example.com', employeeCode: 'NV001', fullName: 'HR User' });
    expect(assignments).toHaveLength(1);
    expect(assignments[0].scopeType).toBe('global');
    expect(assignments[0].overridePermissions).toHaveLength(1);

    const originalHash = account.passwordHash;
    const second = await authMigration.migrateLegacyIdentities([identity()], { apply: true });
    const replayedAccount = await Account.findById(account._id).select('+passwordHash').lean();
    expect(second).toMatchObject({ read: 1, mapped: 1, inserted: 0, unchanged: 1, skipped: 0, failed: 0 });
    expect(replayedAccount.passwordHash).toBe(originalHash);
    await expect(Account.countDocuments()).resolves.toBe(1);
    await expect(UserProfile.countDocuments()).resolves.toBe(1);
    await expect(AccessAssignment.countDocuments()).resolves.toBe(1);
  });

  it('persists inactive employee history without an active access assignment', async () => {
    const item = { ...identity(), accountId: '660000000000000000000102', sourceAccountId: '660000000000000000000102', email: 'resigned@example.com', employeeCode: 'NV002', isActiveOrProbation: false };
    await authMigration.migrateLegacyIdentities([{ ...item, isActiveOrProbation: true }], { apply: true });

    const result = await authMigration.migrateLegacyIdentities([item], { apply: true });

    expect(result).toMatchObject({ mapped: 1, inserted: 0, updated: 1, skipped: 0, failed: 0 });
    const account = await Account.findOne({ normalizedEmail: item.email }).lean();
    expect(account.status).toBe('inactive');
    await expect(UserProfile.countDocuments({ accountId: account._id })).resolves.toBe(1);
    await expect(AccessAssignment.countDocuments({ accountId: account._id, status: 'active' })).resolves.toBe(0);
  });

  it('reports a planned source account id already owned by another target account', async () => {
    const item = { ...identity(), email: 'new@example.com' };
    await Account.create({
      _id: item.accountId,
      email: 'collision@example.com',
      normalizedEmail: 'collision@example.com',
      passwordHash: 'a'.repeat(128),
      passwordSalt: 'b'.repeat(32),
      status: 'active',
    });

    const result = await authMigration.migrateLegacyIdentities([item], { apply: false });

    expect(result).toMatchObject({ read: 1, mapped: 0, skipped: 1, failed: 0 });
    expect(result.skippedRows).toEqual([expect.objectContaining({
      sourceId: item.sourceId,
      reasonCode: 'SOURCE_ACCOUNT_ID_COLLISION',
    })]);
    await expect(Account.countDocuments()).resolves.toBe(1);
  });
});
