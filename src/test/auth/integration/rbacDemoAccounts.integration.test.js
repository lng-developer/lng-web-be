const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const Account = require('../../../modules/auth/models/account.model');
const UserProfile = require('../../../modules/auth/models/userProfile.model');
const AccessAssignment = require('../../../modules/auth/models/accessAssignment.model');
const Role = require('../../../modules/auth/models/role.model');
const accountRepository = require('../../../modules/auth/repositories/account.repository');
const { canAccessScope } = require('../../../modules/auth/middlewares/authorization');
const organizationService = require('../../../modules/organization/services/organization.service');

const describeIfDb = process.env.RUN_DB_RBAC_TESTS === 'true' ? describe : describe.skip;
const operationsDepartmentId = '660000000000000000000001';
const salesTeamId = '660000000000000000000101';
const designTeamId = '660000000000000000000102';

async function loadDemoAccount(roleCode) {
  const role = await Role.findOne({ code: roleCode }).lean();
  expect(role).toBeTruthy();

  const assignment = await AccessAssignment.findOne({
    roleId: role._id,
    status: 'active',
  }).lean();
  expect(assignment).toBeTruthy();

  const [account, profile, authModel] = await Promise.all([
    Account.findById(assignment.accountId).lean(),
    UserProfile.findOne({ accountId: assignment.accountId }).lean(),
    accountRepository.findAuthAccountById(assignment.accountId),
  ]);

  expect(account).toBeTruthy();

  return {
    roleCode,
    account,
    profile,
    assignment,
    auth: {
      accountId: String(authModel.account._id),
      roles: authModel.roles,
      permissions: authModel.permissions,
      scopes: authModel.scopes.map((scope) => ({
        scopeType: scope.scopeType,
        scopeId: scope.scopeId ? String(scope.scopeId) : null,
        roles: scope.roles,
        permissions: scope.permissions,
      })),
    },
  };
}

describeIfDb('demo RBAC accounts from MongoDB', () => {
  let accounts;

  beforeAll(async () => {
    await connectDatabase();
    accounts = {
      admin: await loadDemoAccount('ADMIN'),
      manager: await loadDemoAccount('MANAGER'),
      leader: await loadDemoAccount('LEADER'),
      staff: await loadDemoAccount('USER'),
    };
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  test('admin has global auth and team management permissions', () => {
    expect(accounts.admin.auth.roles).toContain('ADMIN');
    expect(accounts.admin.auth.permissions).toEqual(expect.arrayContaining(['AUTH:WRITE', 'TEAMS:WRITE']));
    expect(canAccessScope(
      accounts.admin.auth,
      'TEAMS:WRITE',
      { scopeType: 'department', scopeId: operationsDepartmentId },
    )).toBe(true);
  });

  test('manager can manage team membership inside the managed department', () => {
    expect(accounts.manager.profile.employeeCode).toBe('J2501');
    expect(accounts.manager.assignment.scopeType).toBe('department');
    expect(String(accounts.manager.assignment.scopeId)).toBe(operationsDepartmentId);
    expect(canAccessScope(
      accounts.manager.auth,
      'TEAMS:WRITE',
      { scopeType: 'department', scopeId: operationsDepartmentId },
    )).toBe(true);
  });

  test('leader can manage staff inside own team but cannot manage department membership', () => {
    expect(accounts.leader.profile.employeeCode).toBe('J2506');
    expect(accounts.leader.assignment.scopeType).toBe('team');
    expect(String(accounts.leader.assignment.scopeId)).toBe(salesTeamId);
    expect(canAccessScope(
      accounts.leader.auth,
      'TEAMS:READ',
      { scopeType: 'team', scopeId: salesTeamId },
    )).toBe(true);
    expect(canAccessScope(
      accounts.leader.auth,
      'TEAMS:WRITE',
      { scopeType: 'team', scopeId: salesTeamId },
    )).toBe(true);
    expect(canAccessScope(
      accounts.leader.auth,
      'TEAMS:WRITE',
      { scopeType: 'department', scopeId: operationsDepartmentId },
    )).toBe(false);
  });

  test('staff has operational scoped permissions but cannot manage team membership', () => {
    expect(accounts.staff.profile.employeeCode).toBe('J2514');
    expect(accounts.staff.assignment.scopeType).toBe('team');
    expect(String(accounts.staff.assignment.scopeId)).toBe(salesTeamId);
    expect(canAccessScope(
      accounts.staff.auth,
      'TEAMS:WRITE',
      { scopeType: 'department', scopeId: operationsDepartmentId },
    )).toBe(false);
  });

  test('manager sees only departments and teams inside own department', async () => {
    const departments = await organizationService.listDepartments({}, { actorAuth: accounts.manager.auth });
    const teams = await organizationService.listTeams({}, { actorAuth: accounts.manager.auth });

    expect(departments.items.map((department) => department.id)).toEqual([operationsDepartmentId]);
    expect(teams.items.map((team) => team.id).sort()).toEqual([designTeamId, salesTeamId].sort());
  });

  test('leader sees own team members and cannot read another team members', async () => {
    const teams = await organizationService.listTeams({}, { actorAuth: accounts.leader.auth });
    const salesMembers = await organizationService.listTeamMembers(salesTeamId, { actorAuth: accounts.leader.auth });

    expect(teams.items.map((team) => team.id)).toEqual([salesTeamId]);
    expect(salesMembers.team.id).toBe(salesTeamId);
    await expect(
      organizationService.listTeamMembers(designTeamId, { actorAuth: accounts.leader.auth }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
