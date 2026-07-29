process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const AuditEvent = require('../../modules/audit/models/auditEvent.model');
const Account = require('../../modules/auth/models/account.model');
const AccessAssignment = require('../../modules/auth/models/accessAssignment.model');
const Role = require('../../modules/auth/models/role.model');
const ScopeRegistry = require('../../modules/auth/models/scopeRegistry.model');
const Department = require('../../modules/organization/models/department.model');
const Team = require('../../modules/organization/models/team.model');
const TeamMembership = require('../../modules/organization/models/teamMembership.model');
const Shop = require('../../modules/shop/models/shop.model');
const authPublic = require('../../modules/auth/public');
const authManager = require('../../modules/auth/services/authManager.service');
const auditPublic = require('../../modules/audit/public');
const organizationService = require('../../modules/organization/services/organization.service');
const shopService = require('../../modules/shop/services/shop.service');

let database;
jest.setTimeout(120000);

describe('scope source mutations share the auth audit transaction', () => {
  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri('lng_web_be_scope_source_audit_test'));
    await Promise.all([
      Account.init(), AccessAssignment.init(), AuditEvent.init(), Department.init(), Role.init(),
      ScopeRegistry.init(), Shop.init(), Team.init(), TeamMembership.init(),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([
      AuditEvent.deleteMany({}), ScopeRegistry.deleteMany({}),
      AccessAssignment.deleteMany({}), Account.deleteMany({}), Department.deleteMany({}),
      Role.deleteMany({}), Shop.deleteMany({}), Team.deleteMany({}), TeamMembership.deleteMany({}),
    ]);
  });

  test('rolls back Shop create when scope audit fails', async () => {
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(shopService.createShop({ name: 'Rollback shop', currency: 'USD' }))
      .rejects.toThrow('audit unavailable');

    await expect(Shop.countDocuments({ name: 'Rollback shop' })).resolves.toBe(0);
    await expect(ScopeRegistry.countDocuments({ scopeType: 'shop' })).resolves.toBe(0);
  });

  test('rolls back Shop update when scope audit fails', async () => {
    const shop = await Shop.create({ name: 'Stable shop', currency: 'USD', status: 'ACTIVE' });
    await ScopeRegistry.create({ scopeType: 'shop', scopeId: shop._id, name: shop.name, status: 'active' });
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(shopService.updateShopStatus(shop._id, 'SUSPENDED'))
      .rejects.toThrow('audit unavailable');

    await expect(Shop.findById(shop._id).lean()).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(ScopeRegistry.findOne({ scopeType: 'shop', scopeId: shop._id }).lean())
      .resolves.toMatchObject({ status: 'active' });
  });

  test('rolls back Organization create when scope audit fails', async () => {
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(organizationService.createDepartment({ name: 'Rollback department', code: 'rollback' }))
      .rejects.toThrow('audit unavailable');

    await expect(Department.countDocuments({ code: 'ROLLBACK' })).resolves.toBe(0);
    await expect(ScopeRegistry.countDocuments({ scopeType: 'department' })).resolves.toBe(0);
  });

  test('rolls back Organization update when scope audit fails', async () => {
    const department = await Department.create({ name: 'Before', code: 'OPS', status: 'active' });
    await ScopeRegistry.create({
      scopeType: 'department', scopeId: department._id, name: department.name, status: 'active',
    });
    jest.spyOn(auditPublic, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(organizationService.updateDepartment(department._id, { name: 'After' }))
      .rejects.toThrow('audit unavailable');

    await expect(Department.findById(department._id).lean()).resolves.toMatchObject({ name: 'Before' });
    await expect(ScopeRegistry.findOne({ scopeType: 'department', scopeId: department._id }).lean())
      .resolves.toMatchObject({ name: 'Before' });
  });

  test('rolls back membership and TEAM assignment on audit failure, then retries exactly once', async () => {
    const [department, account] = await Promise.all([
      Department.create({ name: 'Operations', code: 'OPS', status: 'active' }),
      Account.create({
        email: 'team-member@example.test', passwordHash: 'hash', passwordSalt: 'salt', status: 'active',
      }),
      Role.insertMany([
        { name: 'Leader', code: 'LEADER', permissions: [] },
        { name: 'User', code: 'USER', permissions: [] },
      ]),
    ]);
    const team = await Team.create({ name: 'Team One', code: 'TEAM_ONE', departmentId: department._id, status: 'active' });
    await ScopeRegistry.create({ scopeType: 'team', scopeId: team._id, name: team.name, status: 'active' });
    jest.spyOn(authPublic, 'getCurrentAccount').mockResolvedValue({
      account: { id: String(account._id), email: account.email }, roles: [], permissions: [],
    });
    jest.spyOn(authManager, 'invalidatePermissionCache').mockResolvedValue();
    const auditSpy = jest.spyOn(auditPublic, 'record').mockRejectedValueOnce(new Error('audit unavailable'));
    const actorAuth = { accountId: '660000000000000000000901', permissions: ['TEAMS:WRITE'] };
    const httpContext = { requestId: 'team-membership-write' };

    await expect(organizationService.addTeamMember(team._id, {
      accountId: String(account._id), memberType: 'member',
    }, { actorAuth, httpContext })).rejects.toThrow('audit unavailable');
    expect(await Promise.all([
      TeamMembership.countDocuments({ accountId: account._id, status: 'active' }),
      AccessAssignment.countDocuments({ accountId: account._id, scopeType: 'team', scopeId: team._id, status: 'active' }),
    ])).toEqual([0, 0]);

    auditSpy.mockRestore();
    await organizationService.addTeamMember(team._id, {
      accountId: String(account._id), memberType: 'member',
    }, { actorAuth, httpContext });

    expect(await Promise.all([
      TeamMembership.countDocuments({ accountId: account._id, status: 'active' }),
      AccessAssignment.countDocuments({ accountId: account._id, scopeType: 'team', scopeId: team._id, status: 'active' }),
      AuditEvent.countDocuments({ action: 'ACCESS_ASSIGNMENT_CREATED', entityType: 'AUTH_ACCESS_ASSIGNMENT' }),
    ])).toEqual([1, 1, 1]);
  });
});
