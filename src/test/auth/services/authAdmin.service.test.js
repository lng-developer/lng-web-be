const mongoose = require('mongoose');
const accountRepository = require('../../../modules/auth/repositories/account.repository');
const userProfileRepository = require('../../../modules/auth/repositories/userProfile.repository');
const roleRepository = require('../../../modules/auth/repositories/role.repository');
const permissionRepository = require('../../../modules/auth/repositories/permission.repository');
const accessAssignmentRepository = require('../../../modules/auth/repositories/accessAssignment.repository');
const scopeRegistryRepository = require('../../../modules/auth/repositories/scopeRegistry.repository');
const scopedRolePermissionRepository = require('../../../modules/auth/repositories/scopedRolePermission.repository');
const authManager = require('../../../modules/auth/services/authManager.service');
const organizationPublic = require('../../../modules/organization/public');
const authAdmin = require('../../../modules/auth/services/authAdmin.service');

jest.mock('../../../modules/auth/repositories/account.repository');
jest.mock('../../../modules/auth/repositories/userProfile.repository');
jest.mock('../../../modules/auth/repositories/role.repository');
jest.mock('../../../modules/auth/repositories/permission.repository');
jest.mock('../../../modules/auth/repositories/accessAssignment.repository');
jest.mock('../../../modules/auth/repositories/scopeRegistry.repository');
jest.mock('../../../modules/auth/repositories/scopedRolePermission.repository');
jest.mock('../../../modules/auth/services/authManager.service', () => ({
  invalidatePermissionCache: jest.fn(),
}));
jest.mock('../../../modules/organization/public', () => ({
  listAccountOrganizationSummaries: jest.fn(),
  getDepartmentById: jest.fn(),
  getTeamById: jest.fn(),
}));

describe('authAdmin', () => {
  const accountId = '507f1f77bcf86cd799439011';
  const roleId = '507f1f77bcf86cd799439012';
  const permissionId = '507f1f77bcf86cd799439013';
  const teamId = '660000000000000000000101';

  beforeEach(() => {
    jest.clearAllMocks();
    roleRepository.findById.mockResolvedValue({ _id: roleId, code: 'OPERATOR' });
    accessAssignmentRepository.countByRole.mockResolvedValue(0);
    accessAssignmentRepository.countByCustomPermission.mockResolvedValue(0);
    accessAssignmentRepository.countActiveByScope.mockResolvedValue(0);
    accessAssignmentRepository.findAccountIdsByRole.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByRoles.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByCustomPermission.mockResolvedValue([]);
    roleRepository.countByPermission.mockResolvedValue(0);
    scopedRolePermissionRepository.countByPermission.mockResolvedValue(0);
    scopedRolePermissionRepository.findRoleIdsByPermission.mockResolvedValue([]);
    scopedRolePermissionRepository.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
    });
    scopeRegistryRepository.findActiveByScope.mockResolvedValue({
      _id: '507f1f77bcf86cd799439077',
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      status: 'active',
    });
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([]);
    organizationPublic.getDepartmentById.mockResolvedValue(null);
    organizationPublic.getTeamById.mockResolvedValue(null);
  });

  test('createAccount creates account, profile, and scoped access assignments inside one transaction', async () => {
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    accountRepository.findByNormalizedEmail.mockResolvedValue(null);
    roleRepository.findByIds.mockResolvedValue([{ _id: roleId, code: 'ADMIN' }]);
    permissionRepository.findByIds.mockResolvedValue([{ _id: permissionId, code: 'TEAM_MEMBERS:READ' }]);
    accountRepository.create.mockResolvedValue({
      _id: accountId,
      email: 'new.admin@lng.co',
      status: 'active',
    });
    userProfileRepository.create.mockResolvedValue({
      _id: '507f1f77bcf86cd799439014',
      accountId,
      email: 'new.admin@lng.co',
      fullName: 'New Admin',
    });
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: {
        _id: accountId,
        email: 'new.admin@lng.co',
        status: 'active',
      },
      profile: {
        _id: '507f1f77bcf86cd799439014',
        accountId,
        email: 'new.admin@lng.co',
        fullName: 'New Admin',
      },
      roles: ['ADMIN'],
      permissions: ['AUTH:READ', 'AUTH:WRITE'],
      scopes: [{
        assignmentId: '507f1f77bcf86cd799439016',
        roleId,
        scopeType: 'team',
        scopeId: teamId,
        customPermissionIds: [permissionId],
        roles: ['ADMIN'],
        permissions: ['AUTH:READ', 'AUTH:WRITE'],
      }],
    });

    const result = await authAdmin.createAccount({
      email: 'New.Admin@lng.co ',
      password: 'strong-password',
      fullName: 'New Admin',
      assignments: [{
        roleId,
        scopeType: 'team',
        scopeId: teamId,
        customPermissionIds: [permissionId],
      }],
    });

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(accountRepository.create.mock.calls[0][0]).toMatchObject({
      email: 'new.admin@lng.co',
      normalizedEmail: 'new.admin@lng.co',
      status: 'active',
    });
    expect(accountRepository.create.mock.calls[0][1]).toEqual({ session });
    expect(userProfileRepository.create.mock.calls[0][1]).toEqual({ session });
    expect(accessAssignmentRepository.createMany).toHaveBeenCalledWith([{
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: teamId,
      customPermissions: [permissionId],
      status: 'active',
    }], { session });
    expect(result.roles).toEqual(['ADMIN']);
    expect(session.endSession).toHaveBeenCalledTimes(1);

    mongoose.startSession.mockRestore();
  });

  test('createAccount maps duplicate employee code errors clearly', async () => {
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    accountRepository.findByNormalizedEmail.mockResolvedValue(null);
    roleRepository.findByIds.mockResolvedValue([{ _id: roleId, code: 'USER' }]);
    permissionRepository.findByIds.mockResolvedValue([{ _id: permissionId, code: 'TEAM_MEMBERS:READ' }]);
    accountRepository.create.mockResolvedValue({
      _id: accountId,
      email: 'test01@lng.co',
      status: 'active',
    });
    userProfileRepository.create.mockRejectedValue({
      code: 11000,
      keyPattern: { employeeCode: 1 },
    });

    await expect(authAdmin.createAccount({
      email: 'test01@lng.co',
      password: '123456',
      fullName: 'Test User',
      assignments: [{
        roleId,
        scopeType: 'team',
        scopeId: teamId,
        customPermissionIds: [permissionId],
      }],
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      message: 'Employee code is already in use',
    });

    mongoose.startSession.mockRestore();
  });

  test('listAccounts includes profile and department summary', async () => {
    accountRepository.list.mockResolvedValue({
      items: [{
        _id: accountId,
        email: 'admin@example.com',
        status: 'active',
        profile: {
          _id: '507f1f77bcf86cd799439014',
          accountId,
          email: 'admin@example.com',
          fullName: 'Admin User',
          employeeCode: 'J2501',
        },
        roles: ['LEADER'],
        roleAssignments: [{
          assignmentId: '507f1f77bcf86cd799439016',
          roleId,
          roleCode: 'LEADER',
          roleName: 'Leader',
          scopeType: 'team',
          scopeId: teamId,
        }],
      }],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId,
      memberType: 'leader',
      team: {
        id: teamId,
        name: 'Sales Team',
        code: 'SALES',
        status: 'active',
      },
      department: {
        id: '660000000000000000000001',
        name: 'Operations Department',
        code: 'OPERATIONS',
        status: 'active',
      },
    }]);

    const result = await authAdmin.listAccounts({ page: 1, limit: 20 });

    expect(organizationPublic.listAccountOrganizationSummaries).toHaveBeenCalledWith([accountId]);
    expect(result.items[0]).toMatchObject({
      id: accountId,
      email: 'admin@example.com',
      profile: {
        fullName: 'Admin User',
        employeeCode: 'J2501',
      },
      roles: ['LEADER'],
      roleAssignments: [{
        assignmentId: '507f1f77bcf86cd799439016',
        roleId,
        roleCode: 'LEADER',
        roleName: 'Leader',
        scopeType: 'team',
        scopeId: teamId,
        resourceId: teamId,
      }],
      department: {
        id: '660000000000000000000001',
        name: 'Operations Department',
      },
      team: {
        id: teamId,
        name: 'Sales Team',
      },
      memberType: 'leader',
    });
    expect(result.items[0]).not.toHaveProperty('fullName');
    expect(result.items[0]).not.toHaveProperty('employeeCode');
  });

  test('listRoles includes usage metadata for Roles tab', async () => {
    roleRepository.list.mockResolvedValue({
      items: [{
        _id: roleId,
        name: 'Leader',
        code: 'LEADER',
        description: 'Team leader',
        permissions: [permissionId],
      }],
      page: 1,
      limit: 20,
      total: 1,
    });
    accessAssignmentRepository.countByRole.mockResolvedValue(3);
    permissionRepository.findByIds.mockResolvedValue([{
      _id: permissionId,
      code: 'TEAMS:READ',
      name: 'Read teams',
    }]);

    const result = await authAdmin.listRoles({ page: 1, limit: 20 });

    expect(accessAssignmentRepository.countByRole).toHaveBeenCalledWith(roleId);
    expect(result.items[0]).toMatchObject({
      description: 'Team leader',
      userCount: 3,
      deletable: false,
      permissionCount: 1,
    });
    expect(result.items[0]).not.toHaveProperty('permissionIds');
    expect(result.items[0]).not.toHaveProperty('permissionDetails');
  });

  test('listPermissions includes FE usage metadata', async () => {
    permissionRepository.list.mockResolvedValue({
      items: [{
        _id: permissionId,
        code: 'ORDERS:READ',
        name: 'Read orders',
        description: 'Allows read access',
      }],
      page: 1,
      limit: 20,
      total: 1,
    });
    roleRepository.countByPermission.mockResolvedValue(2);
    scopedRolePermissionRepository.countByPermission.mockResolvedValue(1);
    accessAssignmentRepository.countByCustomPermission.mockResolvedValue(1);

    const result = await authAdmin.listPermissions({ page: 1, limit: 20 });

    expect(result.items[0]).toMatchObject({
      code: 'ORDERS:READ',
      module: 'ORDERS',
      action: 'READ',
      roleCount: 2,
      scopedRoleCount: 1,
      directAssignmentCount: 1,
      usageCount: 4,
      deletable: false,
    });
  });

  test('updateAccountAccess validates refs, updates account, and invalidates permission cache', async () => {
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    roleRepository.findByIds.mockResolvedValue([{ _id: roleId, code: 'OPERATOR' }]);
    permissionRepository.findByIds.mockResolvedValue([{ _id: permissionId, code: 'ORDERS:READ' }]);
    accountRepository.findById.mockResolvedValue({
      _id: accountId,
      email: 'admin@example.com',
      status: 'active',
    });
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: {
        _id: accountId,
        email: 'admin@example.com',
        status: 'active',
      },
      profile: { _id: '507f1f77bcf86cd799439014', accountId, email: 'admin@example.com', fullName: 'Admin' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
      scopes: [{
        assignmentId: '507f1f77bcf86cd799439016',
        roleId,
        scopeType: 'global',
        scopeId: null,
        customPermissionIds: [permissionId],
        roles: ['OPERATOR'],
        permissions: ['ORDERS:READ'],
      }],
    });

    const result = await authAdmin.updateAccountAccess(accountId, {
      roles: [roleId],
      customPermissions: [permissionId],
    });

    expect(accessAssignmentRepository.deactivateActiveGlobalByAccount).toHaveBeenCalledWith(accountId, { session });
    expect(accessAssignmentRepository.createMany).toHaveBeenCalledWith([{
      accountId,
      roleId,
      scopeType: 'global',
      scopeId: null,
      customPermissions: [permissionId],
      status: 'active',
    }], { session });
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.access.roleIds).toEqual([roleId]);
    expect(session.endSession).toHaveBeenCalledTimes(1);

    mongoose.startSession.mockRestore();
  });

  test('createAccessAssignment assigns scoped role and invalidates account cache', async () => {
    accountRepository.findById.mockResolvedValue({ _id: accountId, email: 'admin@example.com' });
    roleRepository.findById.mockResolvedValue({ _id: roleId, code: 'TEAM_LEADER' });
    permissionRepository.findByIds.mockResolvedValue([{ _id: permissionId, code: 'TEAM_MEMBERS:READ' }]);
    accessAssignmentRepository.create.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [permissionId],
      status: 'active',
    });

    const result = await authAdmin.createAccessAssignment({
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [permissionId],
    });

    expect(accessAssignmentRepository.create).toHaveBeenCalledWith({
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [permissionId],
      status: 'active',
    });
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.scopeType).toBe('team');
  });

  test('updateAccessAssignment persists override permissions and invalidates account cache', async () => {
    accessAssignmentRepository.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [],
      status: 'active',
    });
    permissionRepository.findByIds.mockResolvedValue([{ _id: permissionId, code: 'TEAM_MEMBERS:READ' }]);
    accessAssignmentRepository.update.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [],
      overridePermissions: [permissionId],
      status: 'active',
    });

    const result = await authAdmin.updateAccessAssignment('507f1f77bcf86cd799439099', {
      overridePermissions: [permissionId],
    });

    expect(permissionRepository.findByIds).toHaveBeenCalledWith([permissionId]);
    expect(accessAssignmentRepository.update).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439099',
      { overridePermissions: [permissionId] },
    );
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.overridePermissionIds).toEqual([permissionId]);
    expect(result.isPermissionOverridden).toBe(true);
  });

  test('updateAccessAssignment accepts null override permissions to reset inheritance', async () => {
    accessAssignmentRepository.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [],
      overridePermissions: [],
      status: 'active',
    });
    accessAssignmentRepository.update.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [],
      overridePermissions: null,
      status: 'active',
    });

    await authAdmin.updateAccessAssignment('507f1f77bcf86cd799439099', {
      overridePermissions: null,
    });

    expect(permissionRepository.findByIds).not.toHaveBeenCalled();
    expect(accessAssignmentRepository.update).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439099',
      { overridePermissions: null },
    );
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
  });

  test('createScope registers scoped resource for assignments', async () => {
    scopeRegistryRepository.create.mockResolvedValue({
      _id: '507f1f77bcf86cd799439077',
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      name: 'Sales Team',
      status: 'active',
    });

    const result = await authAdmin.createScope({
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      name: 'Sales Team',
    });

    expect(scopeRegistryRepository.create).toHaveBeenCalledWith({
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      name: 'Sales Team',
      status: 'active',
    });
    expect(result.scopeType).toBe('team');
    expect(result.scopeId).toBe('507f1f77bcf86cd799439088');
  });

  test('deactivateScope rejects scopes used by active access assignments', async () => {
    scopeRegistryRepository.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439077',
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      name: 'Sales Team',
      status: 'active',
    });
    accessAssignmentRepository.countActiveByScope.mockResolvedValue(1);

    await expect(authAdmin.deactivateScope('507f1f77bcf86cd799439077')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(scopeRegistryRepository.update).not.toHaveBeenCalled();
  });

  test('createAccessAssignment requires scopeId for team scopes', async () => {
    await expect(authAdmin.createAccessAssignment({
      accountId,
      roleId,
      scopeType: 'team',
      customPermissions: [],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  test('createAccessAssignment rejects unregistered scoped resources', async () => {
    accountRepository.findById.mockResolvedValue({ _id: accountId, email: 'admin@example.com' });
    roleRepository.findById.mockResolvedValue({ _id: roleId, code: 'TEAM_LEADER' });
    permissionRepository.findByIds.mockResolvedValue([]);
    scopeRegistryRepository.findActiveByScope.mockResolvedValue(null);

    await expect(authAdmin.createAccessAssignment({
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });

    expect(accessAssignmentRepository.create).not.toHaveBeenCalled();
  });

  test('createAccessAssignment prevents an ADMIN from granting SUPER_ADMIN', async () => {
    accountRepository.findById.mockResolvedValue({ _id: accountId, email: 'admin@example.com' });
    roleRepository.findById.mockResolvedValue({ _id: roleId, code: 'SUPER_ADMIN' });

    await expect(authAdmin.createAccessAssignment({
      accountId,
      roleId,
      scopeType: 'global',
      customPermissions: [],
    }, { roles: ['ADMIN'] })).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });

    expect(accessAssignmentRepository.create).not.toHaveBeenCalled();
  });

  test('createAccessAssignment rejects global scope with scopeId', async () => {
    await expect(authAdmin.createAccessAssignment({
      accountId,
      roleId,
      scopeType: 'global',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  test('deactivateAccessAssignment marks assignment inactive and invalidates owner account', async () => {
    accessAssignmentRepository.findById.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [],
      status: 'active',
    });
    accessAssignmentRepository.deactivate.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
      customPermissions: [],
      status: 'inactive',
    });

    const result = await authAdmin.deactivateAccessAssignment('507f1f77bcf86cd799439099');

    expect(accessAssignmentRepository.deactivate).toHaveBeenCalledWith('507f1f77bcf86cd799439099');
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.status).toBe('inactive');
  });

  test('updateAccountEmail updates Account and UserProfile in one transaction', async () => {
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    accountRepository.findById.mockResolvedValue({
      _id: accountId,
      email: 'old.admin@lng.co',
      normalizedEmail: 'old.admin@lng.co',
    });
    accountRepository.findByNormalizedEmail.mockResolvedValue(null);
    accountRepository.updateEmail.mockResolvedValue({
      _id: accountId,
      email: 'new.admin@lng.co',
      normalizedEmail: 'new.admin@lng.co',
    });
    userProfileRepository.updateByAccountId.mockResolvedValue({
      _id: '507f1f77bcf86cd799439014',
      accountId,
      email: 'new.admin@lng.co',
      fullName: 'Admin',
    });
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: {
        _id: accountId,
        email: 'new.admin@lng.co',
        status: 'active',
      },
      profile: {
        _id: '507f1f77bcf86cd799439014',
        accountId,
        email: 'new.admin@lng.co',
        fullName: 'Admin',
      },
      roles: ['ADMIN'],
      permissions: ['AUTH:READ'],
      scopes: [{
        assignmentId: '507f1f77bcf86cd799439016',
        roleId,
        scopeType: 'team',
        scopeId: teamId,
        customPermissionIds: [permissionId],
        roles: ['ADMIN'],
        permissions: ['AUTH:READ'],
      }],
    });

    const result = await authAdmin.updateAccountEmail(accountId, 'New.Admin@lng.co ');

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(accountRepository.updateEmail).toHaveBeenCalledWith(
      accountId,
      { email: 'new.admin@lng.co', normalizedEmail: 'new.admin@lng.co' },
      { session },
    );
    expect(userProfileRepository.updateByAccountId).toHaveBeenCalledWith(
      accountId,
      { email: 'new.admin@lng.co' },
      { session },
    );
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.account.email).toBe('new.admin@lng.co');
    expect(session.endSession).toHaveBeenCalledTimes(1);

    mongoose.startSession.mockRestore();
  });

  test('updateAccountEmail rejects duplicate email from another account', async () => {
    accountRepository.findById.mockResolvedValue({ _id: accountId, email: 'admin@example.com' });
    accountRepository.findByNormalizedEmail.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      email: 'taken@example.com',
    });

    await expect(authAdmin.updateAccountEmail(accountId, 'taken@example.com')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(accountRepository.updateEmail).not.toHaveBeenCalled();
  });

  test('updateProfile persists allowed personal metadata', async () => {
    userProfileRepository.updateByAccountId.mockResolvedValue({
      _id: '507f1f77bcf86cd799439014',
      accountId,
      email: 'admin@example.com',
      fullName: 'Admin',
      phone: '+84901234567',
      avatarUrl: 'https://example.com/avatar.png',
      personalEmail: 'personal@example.com',
      dateOfBirth: new Date('1995-01-02T00:00:00.000Z'),
      gender: 'female',
      address: 'Ho Chi Minh City',
    });

    const result = await authAdmin.updateProfile(accountId, {
      fullName: 'Admin',
      phone: '+84901234567',
      avatarUrl: 'https://example.com/avatar.png',
      personalEmail: 'personal@example.com',
      dateOfBirth: new Date('1995-01-02T00:00:00.000Z'),
      gender: 'female',
      address: 'Ho Chi Minh City',
    });

    expect(userProfileRepository.updateByAccountId).toHaveBeenCalledWith(accountId, expect.objectContaining({
      phone: '+84901234567',
      personalEmail: 'personal@example.com',
      gender: 'female',
    }));
    expect(result).toMatchObject({
      phone: '+84901234567',
      personalEmail: 'personal@example.com',
      gender: 'female',
    });
  });

  test('resetPassword delegates to password rotation repository method', async () => {
    accountRepository.updatePassword.mockResolvedValue({
      _id: accountId,
      email: 'admin@example.com',
      status: 'active',
    });

    const result = await authAdmin.resetPassword(accountId, 'new-strong-password');

    expect(accountRepository.updatePassword).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({
        passwordHash: expect.any(String),
        passwordSalt: expect.any(String),
      }),
    );
    expect(result.email).toBe('admin@example.com');
  });

  test('revokeAccountSessions revokes sessions and invalidates permission cache', async () => {
    accountRepository.revokeActiveSessions.mockResolvedValue({
      _id: accountId,
      email: 'admin@example.com',
      status: 'active',
    });

    const result = await authAdmin.revokeAccountSessions(accountId);

    expect(accountRepository.revokeActiveSessions).toHaveBeenCalledWith(accountId);
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result).toMatchObject({
      revoked: true,
      account: {
        id: accountId,
        email: 'admin@example.com',
      },
    });
  });

  test('revokeAccountSessions rejects missing account', async () => {
    accountRepository.revokeActiveSessions.mockResolvedValue(null);

    await expect(authAdmin.revokeAccountSessions(accountId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(authManager.invalidatePermissionCache).not.toHaveBeenCalled();
  });

  test('archiveAccount soft archives account and invalidates permission cache', async () => {
    accountRepository.archive.mockResolvedValue({
      _id: accountId,
      email: 'admin@example.com',
      status: 'archived',
    });

    const result = await authAdmin.archiveAccount(accountId);

    expect(accountRepository.archive).toHaveBeenCalledWith(accountId);
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.status).toBe('archived');
  });

  test('deleteRole rejects roles assigned to accounts', async () => {
    accessAssignmentRepository.countByRole.mockResolvedValue(1);

    await expect(authAdmin.deleteRole(roleId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(roleRepository.deleteById).not.toHaveBeenCalled();
  });

  test('addRolePermission adds one permission and invalidates accounts using role', async () => {
    roleRepository.findById.mockResolvedValue({ _id: roleId, code: 'OPERATOR', permissions: [] });
    permissionRepository.findById.mockResolvedValue({ _id: permissionId, code: 'ORDERS:WRITE' });
    roleRepository.addPermission.mockResolvedValue({
      _id: roleId,
      code: 'OPERATOR',
      name: 'Operator',
      permissions: [permissionId],
    });
    accessAssignmentRepository.findAccountIdsByRole.mockResolvedValue([{ accountId }]);

    const result = await authAdmin.addRolePermission(roleId, permissionId);

    expect(roleRepository.addPermission).toHaveBeenCalledWith(roleId, permissionId);
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.permissions).toEqual([permissionId]);
  });

  test('removeRolePermission removes one permission and invalidates accounts using role', async () => {
    roleRepository.findById.mockResolvedValue({ _id: roleId, code: 'OPERATOR', permissions: [permissionId] });
    roleRepository.removePermission.mockResolvedValue({
      _id: roleId,
      code: 'OPERATOR',
      name: 'Operator',
      permissions: [],
    });
    accessAssignmentRepository.findAccountIdsByRole.mockResolvedValue([{ accountId }]);

    const result = await authAdmin.removeRolePermission(roleId, permissionId);

    expect(roleRepository.removePermission).toHaveBeenCalledWith(roleId, permissionId);
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.permissions).toEqual([]);
  });

  test('deletePermission rejects permissions assigned to roles', async () => {
    accessAssignmentRepository.countByCustomPermission.mockResolvedValue(0);
    roleRepository.countByPermission.mockResolvedValue(1);
    scopedRolePermissionRepository.countByPermission.mockResolvedValue(0);

    await expect(authAdmin.deletePermission(permissionId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(permissionRepository.deleteById).not.toHaveBeenCalled();
  });

  test('createPermission stores optional description', async () => {
    permissionRepository.findByCode.mockResolvedValue(null);
    permissionRepository.create.mockResolvedValue({
      _id: permissionId,
      code: 'ORDERS:READ',
      description: 'Allows read access for orders.',
    });

    const result = await authAdmin.createPermission({
      code: 'orders:read',
      description: ' Allows read access for orders. ',
    });

    expect(permissionRepository.create).toHaveBeenCalledWith({
      code: 'ORDERS:READ',
      description: 'Allows read access for orders.',
    });
    expect(result).toMatchObject({
      code: 'ORDERS:READ',
      description: 'Allows read access for orders.',
    });
  });

  test('updatePermission invalidates accounts affected through custom permissions and roles', async () => {
    permissionRepository.findByCode.mockResolvedValue(null);
    permissionRepository.update.mockResolvedValue({
      _id: permissionId,
      code: 'ORDERS:WRITE',
      description: 'Allows write access for orders.',
    });
    accessAssignmentRepository.findAccountIdsByCustomPermission.mockResolvedValue([{ accountId }]);
    roleRepository.findRoleIdsByPermission.mockResolvedValue([{ _id: roleId }]);
    scopedRolePermissionRepository.findRoleIdsByPermission.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByRoles.mockResolvedValue([{ accountId: '507f1f77bcf86cd799439015' }]);

    const result = await authAdmin.updatePermission(permissionId, {
      code: 'orders:write',
      description: 'Allows write access for orders.',
    });

    expect(permissionRepository.update).toHaveBeenCalledWith(permissionId, {
      code: 'ORDERS:WRITE',
      description: 'Allows write access for orders.',
    });
    expect(result.code).toBe('ORDERS:WRITE');
    expect(result.description).toBe('Allows write access for orders.');
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith('507f1f77bcf86cd799439015');
  });

  test('updatePermission allows description-only updates', async () => {
    permissionRepository.update.mockResolvedValue({
      _id: permissionId,
      code: 'ORDERS:READ',
      description: 'Allows read access for orders.',
    });
    accessAssignmentRepository.findAccountIdsByCustomPermission.mockResolvedValue([]);
    roleRepository.findRoleIdsByPermission.mockResolvedValue([]);
    scopedRolePermissionRepository.findRoleIdsByPermission.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByRoles.mockResolvedValue([]);

    const result = await authAdmin.updatePermission(permissionId, {
      description: 'Allows read access for orders.',
    });

    expect(permissionRepository.findByCode).not.toHaveBeenCalled();
    expect(permissionRepository.update).toHaveBeenCalledWith(permissionId, {
      description: 'Allows read access for orders.',
    });
    expect(result).toMatchObject({
      code: 'ORDERS:READ',
      description: 'Allows read access for orders.',
    });
  });

  test('setScopedRolePermissions writes canonical scoped rule and invalidates role accounts', async () => {
    roleRepository.findById.mockResolvedValue({ _id: roleId, code: 'LEADER' });
    permissionRepository.findByIds.mockResolvedValue([{ _id: permissionId, code: 'TEAMS:WRITE' }]);
    scopedRolePermissionRepository.upsert.mockResolvedValue({
      _id: '660000000000000000000301',
      scopeType: 'team',
      scopeId: teamId,
      roleId,
      permissions: [permissionId],
    });
    accessAssignmentRepository.findAccountIdsByRole.mockResolvedValue([{ accountId }]);

    const result = await authAdmin.setScopedRolePermissions({
      scopeType: 'team',
      scopeId: teamId,
      roleId,
      permissionIds: [permissionId],
    });

    expect(scopedRolePermissionRepository.upsert).toHaveBeenCalledWith({
      scopeType: 'team',
      scopeId: teamId,
      roleId,
      permissions: [permissionId],
    });
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result).toMatchObject({
      scopeType: 'team',
      scopeId: teamId,
      roleId,
      permissionIds: [permissionId],
    });
  });

  test('ensureTeamLeaderAssignment creates team scoped leader assignment and removes user assignment', async () => {
    accountRepository.findById.mockResolvedValue({ _id: accountId, email: 'leader@example.com' });
    roleRepository.findByCode
      .mockResolvedValueOnce({ _id: roleId, code: 'LEADER' })
      .mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439014', code: 'USER' });
    accessAssignmentRepository.upsertActiveScopedRole.mockResolvedValue({
      _id: '660000000000000000000401',
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: teamId,
      customPermissions: [],
      status: 'active',
    });

    const result = await authAdmin.ensureTeamLeaderAssignment(accountId, teamId);

    expect(accessAssignmentRepository.upsertActiveScopedRole).toHaveBeenCalledWith({
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: teamId,
      customPermissions: [],
      status: 'active',
    }, {});
    expect(accessAssignmentRepository.deactivateActiveByAccountRoleScope).toHaveBeenCalledWith(
      accountId,
      '507f1f77bcf86cd799439014',
      'team',
      teamId,
      {},
    );
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.roleId).toBe(roleId);
  });

  test('ensureTeamMemberAssignment replaces team scoped leader assignment with user assignment', async () => {
    accountRepository.findById.mockResolvedValue({ _id: accountId, email: 'member@example.com' });
    roleRepository.findByCode
      .mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439014', code: 'USER' })
      .mockResolvedValueOnce({ _id: roleId, code: 'LEADER' });
    accessAssignmentRepository.upsertActiveScopedRole.mockResolvedValue({
      _id: '660000000000000000000402',
      accountId,
      roleId: '507f1f77bcf86cd799439014',
      scopeType: 'team',
      scopeId: teamId,
      customPermissions: [],
      status: 'active',
    });

    const result = await authAdmin.ensureTeamMemberAssignment(accountId, teamId);

    expect(accessAssignmentRepository.upsertActiveScopedRole).toHaveBeenCalledWith({
      accountId,
      roleId: '507f1f77bcf86cd799439014',
      scopeType: 'team',
      scopeId: teamId,
      customPermissions: [],
      status: 'active',
    }, {});
    expect(accessAssignmentRepository.deactivateActiveByAccountRoleScope).toHaveBeenCalledWith(
      accountId,
      roleId,
      'team',
      teamId,
      {},
    );
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.roleId).toBe('507f1f77bcf86cd799439014');
  });
});
