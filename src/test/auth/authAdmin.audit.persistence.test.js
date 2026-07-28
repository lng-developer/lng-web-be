const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Account = require('../../modules/auth/models/account.model');
const Role = require('../../modules/auth/models/role.model');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const auditPublic = require('../../modules/audit/public');
const authAdmin = require('../../modules/auth/services/authAdmin.service');

let database;
jest.setTimeout(120000);

describe('auth administration audit transactions', () => {
  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri('lng_web_be_auth_admin_audit_test'));
    await Promise.all([Account.init(), Role.init(), AuditEvent.init()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([Account.deleteMany({}), Role.deleteMany({}), AuditEvent.deleteMany({})]);
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
});
