const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const Account = require('../../../modules/auth/models/account.model');
const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const AccessAssignment = require('../../../modules/auth/models/accessAssignment.model');
const Role = require('../../../modules/auth/models/role.model');
const accountRepository = require('../../../modules/auth/repositories/account.repository');
const { canAccessScope } = require('../../../modules/auth/middlewares/authorization');
const organizationService = require('../../../modules/organization/services/organization.service');

const describeIfDb = process.env.RUN_DB_RBAC_TESTS === 'true' ? describe : describe.skip;
const operationsDepartmentId = '660000000000000000000001';
const salesTeamId = '660000000000000000000101';
const designTeamId = '660000000000000000000102';
const footballShopId = '660000000000000000000201';
const petMemorialShopId = '660000000000000000000202';

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
    EmployeeProfile.findOne({ accountId: assignment.accountId, isDeleted: false }).lean(),
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

async function loadDemoAccountByEmail(email) {
  const account = await Account.findOne({ email }).lean();
  expect(account).toBeTruthy();

  const [profile, assignment, authModel] = await Promise.all([
    EmployeeProfile.findOne({ accountId: account._id, isDeleted: false }).lean(),
    AccessAssignment.findOne({
      accountId: account._id,
      status: 'active',
    }).lean(),
    accountRepository.findAuthAccountById(account._id),
  ]);
  expect(profile).toBeTruthy();
  expect(assignment).toBeTruthy();

  const role = await Role.findById(assignment.roleId).lean();
  expect(role).toBeTruthy();

  return {
    roleCode: role.code,
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
      admin: await loadDemoAccount('SUPER_ADMIN'),
      manager: await loadDemoAccount('MANAGER'),
      leader: await loadDemoAccount('LEADER'),
      staff: await loadDemoAccount('USER'),
      salesLeader: await loadDemoAccountByEmail('j2506@demo.lng.co'),
      designLeader: await loadDemoAccountByEmail('j2510@demo.lng.co'),
      salesUser: await loadDemoAccountByEmail('j2514@demo.lng.co'),
      csUser: await loadDemoAccountByEmail('j2515@demo.lng.co'),
      designUser: await loadDemoAccountByEmail('j2523@demo.lng.co'),
      qcUser: await loadDemoAccountByEmail('j2524@demo.lng.co'),
      shopUser: await loadDemoAccountByEmail('j2531@demo.lng.co'),
      footballScaleUser: await loadDemoAccountByEmail('j2532@demo.lng.co'),
      footballQcUser: await loadDemoAccountByEmail('j2533@demo.lng.co'),
      footballCsUser: await loadDemoAccountByEmail('j2534@demo.lng.co'),
      petShopUser: await loadDemoAccountByEmail('j2536@demo.lng.co'),
    };
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  test('admin has global auth and team management permissions', () => {
    expect(accounts.admin.auth.roles).toContain('SUPER_ADMIN');
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

  test('canonical demo accounts resolve expected roles and scopes', () => {
    expect(accounts.salesLeader).toMatchObject({
      roleCode: 'LEADER',
      profile: { employeeCode: 'J2506' },
    });
    expect(accounts.salesLeader.assignment.scopeType).toBe('team');
    expect(String(accounts.salesLeader.assignment.scopeId)).toBe(salesTeamId);

    expect(accounts.designLeader).toMatchObject({
      roleCode: 'LEADER',
      profile: { employeeCode: 'J2510' },
    });
    expect(accounts.designLeader.assignment.scopeType).toBe('team');
    expect(String(accounts.designLeader.assignment.scopeId)).toBe(designTeamId);

    expect(accounts.designUser).toMatchObject({
      roleCode: 'USER',
      profile: { employeeCode: 'J2523' },
    });
    expect(accounts.designUser.assignment.scopeType).toBe('team');
    expect(String(accounts.designUser.assignment.scopeId)).toBe(designTeamId);

    expect(accounts.csUser).toMatchObject({
      roleCode: 'USER',
      profile: { employeeCode: 'J2515' },
    });
    expect(accounts.csUser.assignment.scopeType).toBe('team');
    expect(String(accounts.csUser.assignment.scopeId)).toBe(salesTeamId);

    expect(accounts.qcUser).toMatchObject({
      roleCode: 'USER',
      profile: { employeeCode: 'J2524' },
    });
    expect(accounts.qcUser.assignment.scopeType).toBe('team');
    expect(String(accounts.qcUser.assignment.scopeId)).toBe(designTeamId);

    expect(accounts.shopUser.assignment.scopeType).toBe('shop');
    expect(String(accounts.shopUser.assignment.scopeId)).toBe(footballShopId);
    expect(accounts.footballScaleUser.profile.employeeCode).toBe('J2532');
    expect(accounts.footballQcUser.profile.employeeCode).toBe('J2533');
    expect(accounts.footballCsUser.profile.employeeCode).toBe('J2534');
    expect(accounts.footballScaleUser.assignment.scopeType).toBe('shop');
    expect(String(accounts.footballScaleUser.assignment.scopeId)).toBe(footballShopId);
    expect(accounts.petShopUser.assignment.scopeType).toBe('shop');
    expect(String(accounts.petShopUser.assignment.scopeId)).toBe(petMemorialShopId);
  });

  test('design role permissions are layered by role', () => {
    const designUserScope = accounts.designUser.auth.scopes[0];
    expect(designUserScope.permissions).toContain('DESIGN:WORK');
    expect(designUserScope.permissions).not.toContain('DESIGN:WRITE');
    expect(designUserScope.permissions).not.toContain('DESIGN:REVIEW');

    const qcUserScope = accounts.qcUser.auth.scopes[0];
    expect(qcUserScope.permissions).toContain('DESIGN:REVIEW');
    expect(qcUserScope.permissions).not.toContain('DESIGN:WORK');

    const designLeaderScope = accounts.designLeader.auth.scopes[0];
    expect(designLeaderScope.permissions).toEqual(expect.arrayContaining([
      'DESIGN:READ',
      'DESIGN:WRITE',
      'DESIGN:WORK',
      'DESIGN:REVIEW',
    ]));

    const managerScope = accounts.manager.auth.scopes[0];
    expect(managerScope.permissions).toEqual(expect.arrayContaining([
      'DESIGN:READ',
      'DESIGN:WRITE',
      'DESIGN:WORK',
      'DESIGN:REVIEW',
    ]));
  });

  test('sales staff and CS coordinator have separate production permissions', () => {
    const salesUserScope = accounts.salesUser.auth.scopes[0];
    expect(salesUserScope.permissions).toEqual(expect.arrayContaining([
      'ORDERS:READ',
      'ORDERS:WRITE',
    ]));
    expect(salesUserScope.permissions).not.toContain('PRODUCTION:WRITE');

    const csUserScope = accounts.csUser.auth.scopes[0];
    expect(csUserScope.permissions).toEqual(expect.arrayContaining([
      'ORDERS:READ',
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
    ]));
    expect(csUserScope.permissions).not.toContain('ORDERS:WRITE');
  });

  test('shop production personas split scale, QC, and CS permissions', () => {
    const scaleScope = accounts.footballScaleUser.auth.scopes[0];
    expect(scaleScope.permissions).toEqual(expect.arrayContaining([
      'DESIGN:WORK',
      'PRODUCTION:READ',
    ]));
    expect(scaleScope.permissions).not.toContain('DESIGN:REVIEW');
    expect(scaleScope.permissions).not.toContain('PRODUCTION:WRITE');

    const qcScope = accounts.footballQcUser.auth.scopes[0];
    expect(qcScope.permissions).toEqual(expect.arrayContaining([
      'DESIGN:REVIEW',
      'PRODUCTION:READ',
    ]));
    expect(qcScope.permissions).not.toContain('DESIGN:WORK');
    expect(qcScope.permissions).not.toContain('PRODUCTION:WRITE');

    const csScope = accounts.footballCsUser.auth.scopes[0];
    expect(csScope.permissions).toEqual(expect.arrayContaining([
      'PRODUCTION:READ',
      'PRODUCTION:WRITE',
    ]));
    expect(csScope.permissions).not.toContain('DESIGN:WORK');
    expect(csScope.permissions).not.toContain('DESIGN:REVIEW');
  });

  test('scoped shop users cannot cross shop boundaries', () => {
    expect(canAccessScope(
      accounts.shopUser.auth,
      'ORDERS:READ',
      { scopeType: 'shop', scopeId: footballShopId },
    )).toBe(true);
    expect(canAccessScope(
      accounts.shopUser.auth,
      'ORDERS:READ',
      { scopeType: 'shop', scopeId: petMemorialShopId },
    )).toBe(false);
  });

  test('leader scope does not leak to sibling team or department', () => {
    expect(canAccessScope(
      accounts.designLeader.auth,
      'DESIGN:REVIEW',
      { scopeType: 'team', scopeId: designTeamId },
    )).toBe(true);
    expect(canAccessScope(
      accounts.designLeader.auth,
      'DESIGN:REVIEW',
      { scopeType: 'team', scopeId: salesTeamId },
    )).toBe(false);
    expect(canAccessScope(
      accounts.designLeader.auth,
      'DESIGN:REVIEW',
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
