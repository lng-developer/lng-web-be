const mongoose = require('mongoose');
const accountRepository = require('../../../modules/auth/repositories/account.repository');
const roleRepository = require('../../../modules/auth/repositories/role.repository');
const permissionRepository = require('../../../modules/auth/repositories/permission.repository');
const accessAssignmentRepository = require('../../../modules/auth/repositories/accessAssignment.repository');
const scopeRegistryRepository = require('../../../modules/auth/repositories/scopeRegistry.repository');
const scopedRolePermissionRepository = require('../../../modules/auth/repositories/scopedRolePermission.repository');
const authManager = require('../../../modules/auth/services/authManager.service');
const organizationPublic = require('../../../modules/organization/public');
const auditPublic = require('../../../modules/audit/public');
accessAssignmentRepository.findActiveByAccountRoleScope = jest.fn();
const authAdmin = require('../../../modules/auth/services/authAdmin.service');

jest.mock('../../../modules/auth/repositories/account.repository');
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
jest.mock('../../../modules/audit/public', () => ({ record: jest.fn() }));

describe('authAdmin', () => {
  const accountId = '507f1f77bcf86cd799439011';
  const roleId = '507f1f77bcf86cd799439012';
  const permissionId = '507f1f77bcf86cd799439013';
  const teamId = '660000000000000000000101';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue({
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    });
    roleRepository.findById.mockResolvedValue({ _id: roleId, code: 'OPERATOR' });
    roleRepository.findByCode.mockResolvedValue(null);
    roleRepository.touchById.mockImplementation(async (id) => ({
      ...(await roleRepository.findById(id)), _id: id,
    }));
    permissionRepository.findByCode.mockResolvedValue(null);
    permissionRepository.touchById.mockImplementation((id) => permissionRepository.findById(id));
    permissionRepository.touchByIds.mockImplementation(async (ids) => {
      if (ids.length === 0) return 0;
      return (await permissionRepository.findByIds(ids)).length;
    });
    accessAssignmentRepository.countByRole.mockResolvedValue(0);
    accessAssignmentRepository.countByCustomPermission.mockResolvedValue(0);
    accessAssignmentRepository.countActiveByScope.mockResolvedValue(0);
    accessAssignmentRepository.findAccountIdsByRole.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByRoles.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByCustomPermission.mockResolvedValue([]);
    accessAssignmentRepository.findActiveByAccountRoleScope.mockResolvedValue(null);
    roleRepository.countByPermission.mockResolvedValue(0);
    scopedRolePermissionRepository.countByPermission.mockResolvedValue(0);
    scopedRolePermissionRepository.countByRole.mockResolvedValue(0);
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
    scopeRegistryRepository.touchActiveByScope.mockResolvedValue({
      _id: '507f1f77bcf86cd799439077', scopeType: 'team', scopeId: teamId, status: 'active',
    });
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([]);
    organizationPublic.getDepartmentById.mockResolvedValue(null);
    organizationPublic.getTeamById.mockResolvedValue(null);
    auditPublic.record.mockResolvedValue({ id: 'audit-event-id' });
  });

  test('createAccount creates account and scoped access assignments inside one transaction', async () => {
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    accountRepository.findByEmail.mockResolvedValue(null);
    roleRepository.findByIds.mockResolvedValue([{ _id: roleId, code: 'ADMIN' }]);
    permissionRepository.findByIds.mockResolvedValue([{ _id: permissionId, code: 'TEAM_MEMBERS:READ' }]);
    accountRepository.create.mockResolvedValue({
      _id: accountId,
      email: 'new.admin@lng.co',
      status: 'active',
    });
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: {
        _id: accountId,
        email: 'new.admin@lng.co',
        status: 'active',
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
      status: 'active',
    });
    expect(accountRepository.create.mock.calls[0][1]).toEqual({ session });
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

  test('listAccounts includes account and department summary', async () => {
    accountRepository.list.mockResolvedValue({
      items: [{
        _id: accountId,
        email: 'admin@example.com',
        status: 'active',
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
    expect(result.items[0]).not.toHaveProperty('profile');
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

  test('listAssignableRoles hides SUPER_ADMIN from non-super-admin callers', async () => {
    roleRepository.listAssignable.mockResolvedValue([
      { _id: roleId, code: 'OPERATOR', name: 'Operator', description: 'Daily operations' },
      { _id: '507f1f77bcf86cd799439099', code: 'SUPER_ADMIN', name: 'Super admin', description: 'System owner' },
    ]);

    await expect(authAdmin.listAssignableRoles({ roles: ['HR_MANAGER'] })).resolves.toEqual([
      { _id: roleId, code: 'OPERATOR', name: 'Operator', description: 'Daily operations' },
    ]);
    await expect(authAdmin.listAssignableRoles({ roles: ['SUPER_ADMIN'] })).resolves.toHaveLength(2);
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
    }, { session: expect.anything() });
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
      { session: expect.anything() },
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
      { session: expect.anything() },
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
    }, { session: expect.anything() });
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
    scopeRegistryRepository.touchActiveByScope.mockResolvedValue(null);

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

    expect(accessAssignmentRepository.deactivate).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439099', { session: expect.anything() },
    );
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.status).toBe('inactive');
  });

  test('updateAccountEmail updates only the login account email', async () => {
    accountRepository.findById.mockResolvedValue({
      _id: accountId,
      email: 'old.admin@lng.co',
    });
    accountRepository.findByEmail.mockResolvedValue(null);
    accountRepository.updateEmail.mockResolvedValue({
      _id: accountId,
      email: 'new.admin@lng.co',
    });
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: {
        _id: accountId,
        email: 'new.admin@lng.co',
        status: 'active',
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

    expect(accountRepository.updateEmail).toHaveBeenCalledWith(
      accountId, 'new.admin@lng.co', { session: expect.anything() },
    );
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.account.email).toBe('new.admin@lng.co');
  });

  test('updateAccountEmail rejects duplicate email from another account', async () => {
    accountRepository.findById.mockResolvedValue({ _id: accountId, email: 'admin@example.com' });
    accountRepository.findByEmail.mockResolvedValue({
      _id: '507f1f77bcf86cd799439099',
      email: 'taken@example.com',
    });

    await expect(authAdmin.updateAccountEmail(accountId, 'taken@example.com')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(accountRepository.updateEmail).not.toHaveBeenCalled();
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
      { session: expect.anything() },
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

    expect(accountRepository.revokeActiveSessions).toHaveBeenCalledWith(
      accountId, { session: expect.anything() },
    );
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

    expect(accountRepository.archive).toHaveBeenCalledWith(accountId, { session: expect.anything() });
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.status).toBe('archived');
  });

  test('updateAccountEmail audits a true no-op without rotating tokens or sessions', async () => {
    accountRepository.findById.mockResolvedValue({
      _id: accountId, email: 'admin@example.com', status: 'active', tokenVersion: 7,
    });
    accountRepository.findByEmail.mockResolvedValue({ _id: accountId, email: 'admin@example.com' });
    accountRepository.findAuthAccountById.mockResolvedValue({
      account: { _id: accountId, email: 'admin@example.com', status: 'active', tokenVersion: 7 },
      roles: [], permissions: [], scopes: [],
    });

    await authAdmin.updateAccountEmail(accountId, ' ADMIN@example.com ');

    expect(accountRepository.updateEmail).not.toHaveBeenCalled();
    expect(authManager.invalidatePermissionCache).not.toHaveBeenCalled();
    expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'ACCOUNT_EMAIL_UPDATED', changes: { email: { changed: false } }, metadata: { noOp: true },
    }), { session: expect.anything() });
  });

  test('archiveAccount audits a true no-op without rotating tokens or sessions', async () => {
    accountRepository.findById.mockResolvedValue({
      _id: accountId, email: 'admin@example.com', status: 'archived', tokenVersion: 7,
    });

    const result = await authAdmin.archiveAccount(accountId);

    expect(accountRepository.archive).not.toHaveBeenCalled();
    expect(authManager.invalidatePermissionCache).not.toHaveBeenCalled();
    expect(result.status).toBe('archived');
    expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'ACCOUNT_ARCHIVED', changes: {}, metadata: { noOp: true },
    }), { session: expect.anything() });
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

    expect(roleRepository.addPermission).toHaveBeenCalledWith(
      roleId, permissionId, { session: expect.anything() },
    );
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

    expect(roleRepository.removePermission).toHaveBeenCalledWith(
      roleId, permissionId, { session: expect.anything() },
    );
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
      name: undefined,
      description: 'Allows read access for orders.',
    }, { session: expect.anything() });
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
    }, { session: expect.anything() });
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
    }, { session: expect.anything() });
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
    }, { session: expect.anything() });
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
    accessAssignmentRepository.findActiveByAccountRoleScope
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: '660000000000000000000499', accountId,
        roleId: '507f1f77bcf86cd799439014', scopeType: 'team', scopeId: teamId, status: 'active',
      });

    const result = await authAdmin.ensureTeamLeaderAssignment(accountId, teamId);

    expect(accessAssignmentRepository.upsertActiveScopedRole).toHaveBeenCalledWith({
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: teamId,
      customPermissions: [],
      status: 'active',
    }, { session: expect.any(Object) });
    expect(accessAssignmentRepository.deactivateActiveByAccountRoleScope).toHaveBeenCalledWith(
      accountId,
      '507f1f77bcf86cd799439014',
      'team',
      teamId,
      { session: expect.any(Object) },
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
    accessAssignmentRepository.findActiveByAccountRoleScope
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: '660000000000000000000498', accountId,
        roleId, scopeType: 'team', scopeId: teamId, status: 'active',
      });

    const result = await authAdmin.ensureTeamMemberAssignment(accountId, teamId);

    expect(accessAssignmentRepository.upsertActiveScopedRole).toHaveBeenCalledWith({
      accountId,
      roleId: '507f1f77bcf86cd799439014',
      scopeType: 'team',
      scopeId: teamId,
      customPermissions: [],
      status: 'active',
    }, { session: expect.any(Object) });
    expect(accessAssignmentRepository.deactivateActiveByAccountRoleScope).toHaveBeenCalledWith(
      accountId,
      roleId,
      'team',
      teamId,
      { session: expect.any(Object) },
    );
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(result.roleId).toBe('507f1f77bcf86cd799439014');
  });

  test('team assignment sync audits only the created and deactivated assignments with caller context', async () => {
    const actor = { accountId: '507f1f77bcf86cd799439021', roles: ['ADMIN'] };
    const httpContext = { requestId: 'organization-member-update', ipAddress: '127.0.0.1', userAgent: 'jest' };
    const session = { id: 'organization-session' };
    const leaderAssignmentId = '660000000000000000000401';
    const memberAssignmentId = '660000000000000000000402';
    accountRepository.findById.mockResolvedValue({ _id: accountId });
    roleRepository.findByCode
      .mockResolvedValueOnce({ _id: roleId, code: 'LEADER' })
      .mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439014', code: 'USER' });
    accessAssignmentRepository.findActiveByAccountRoleScope
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: memberAssignmentId, accountId, roleId: '507f1f77bcf86cd799439014',
        scopeType: 'team', scopeId: teamId, status: 'active',
      });
    accessAssignmentRepository.upsertActiveScopedRole.mockResolvedValue({
      _id: leaderAssignmentId, accountId, roleId, scopeType: 'team', scopeId: teamId,
      customPermissions: [], status: 'active',
    });

    await authAdmin.ensureTeamLeaderAssignment(accountId, teamId, {
      session, authContext: actor, httpContext,
    });

    expect(auditPublic.record).toHaveBeenCalledTimes(2);
    expect(auditPublic.record).toHaveBeenNthCalledWith(1, expect.objectContaining({
      actorType: 'ACCOUNT', actorAccountId: actor.accountId, source: 'HTTP',
      action: 'ACCESS_ASSIGNMENT_CREATED', entityId: leaderAssignmentId,
      scopeType: 'TEAM', scopeId: teamId, requestId: httpContext.requestId,
    }), { session });
    expect(auditPublic.record).toHaveBeenNthCalledWith(2, expect.objectContaining({
      actorType: 'ACCOUNT', actorAccountId: actor.accountId, source: 'HTTP',
      action: 'ACCESS_ASSIGNMENT_DEACTIVATED', entityId: memberAssignmentId,
      scopeType: 'TEAM', scopeId: teamId, requestId: httpContext.requestId,
    }), { session });
  });

  test('team assignment sync is a mutation-free audit-free no-op when the desired role is already active', async () => {
    const existing = {
      _id: '660000000000000000000401', accountId, roleId, scopeType: 'team', scopeId: teamId,
      customPermissions: [], status: 'active',
    };
    accountRepository.findById.mockResolvedValue({ _id: accountId });
    roleRepository.findByCode
      .mockResolvedValueOnce({ _id: roleId, code: 'LEADER' })
      .mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439014', code: 'USER' });
    accessAssignmentRepository.findActiveByAccountRoleScope
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);

    const result = await authAdmin.ensureTeamLeaderAssignment(accountId, teamId, {
      authContext: { accountId: '507f1f77bcf86cd799439021' },
      httpContext: { requestId: 'organization-member-noop' },
    });

    expect(result.id).toBe(existing._id);
    expect(accessAssignmentRepository.upsertActiveScopedRole).not.toHaveBeenCalled();
    expect(accessAssignmentRepository.deactivateActiveByAccountRoleScope).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('team assignment removal audits only active assignments with the caller transaction context', async () => {
    const actor = { accountId: '507f1f77bcf86cd799439021', roles: ['ADMIN'] };
    const httpContext = { requestId: 'organization-member-remove', ipAddress: '127.0.0.1' };
    const session = { id: 'organization-remove-session' };
    const assignment = {
      _id: '660000000000000000000401', accountId, roleId,
      scopeType: 'team', scopeId: teamId, status: 'active',
    };
    roleRepository.findByCode
      .mockResolvedValueOnce({ _id: roleId, code: 'LEADER' })
      .mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439014', code: 'USER' });
    accessAssignmentRepository.findActiveByAccountRoleScope
      .mockResolvedValueOnce(assignment)
      .mockResolvedValueOnce(null);

    const result = await authAdmin.deactivateTeamRoleAssignments(accountId, teamId, {
      session, authContext: actor, httpContext,
    });

    expect(result).toEqual({ deactivated: true });
    expect(accessAssignmentRepository.deactivateActiveByAccountRoleScope).toHaveBeenCalledTimes(1);
    expect(auditPublic.record).toHaveBeenCalledTimes(1);
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT', actorAccountId: actor.accountId, source: 'HTTP',
      action: 'ACCESS_ASSIGNMENT_DEACTIVATED', entityId: assignment._id,
      scopeType: 'TEAM', scopeId: teamId, requestId: httpContext.requestId,
    }), { session });
  });

  describe('administration audit events', () => {
    const actor = { accountId: '507f1f77bcf86cd799439021', roles: ['SUPER_ADMIN'] };
    const httpContext = {
      requestId: 'request-admin-1',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    };
    const assignmentId = '507f1f77bcf86cd799439099';
    const scopeRegistryId = '507f1f77bcf86cd799439077';
    let session;

    beforeEach(() => {
      session = {
        withTransaction: jest.fn(async (callback) => callback()),
        endSession: jest.fn(),
      };
      jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      accountRepository.findById.mockResolvedValue({
        _id: accountId, email: 'old@example.com', status: 'active',
      });
      accountRepository.findByEmail.mockResolvedValue(null);
      accountRepository.findAuthAccountById.mockResolvedValue({
        account: { _id: accountId, email: 'new@example.com', status: 'active' },
        roles: [], permissions: [], scopes: [],
      });
      accountRepository.create.mockResolvedValue({ _id: accountId, status: 'active' });
      accountRepository.updateStatus.mockResolvedValue({ _id: accountId, status: 'inactive' });
      accountRepository.updateEmail.mockResolvedValue({ _id: accountId, email: 'new@example.com', status: 'active' });
      accountRepository.updatePassword.mockResolvedValue({ _id: accountId, email: 'old@example.com', status: 'active' });
      accountRepository.revokeActiveSessions.mockResolvedValue({ _id: accountId, email: 'old@example.com', status: 'active' });
      accountRepository.archive.mockResolvedValue({ _id: accountId, email: 'old@example.com', status: 'archived' });
      roleRepository.findByIds.mockImplementation(async (ids) => ids.map((id) => ({ _id: id, code: 'OPERATOR' })));
      roleRepository.findById.mockResolvedValue({ _id: roleId, code: 'OPERATOR', permissions: [] });
      roleRepository.findByCode.mockResolvedValue(null);
      roleRepository.create.mockResolvedValue({ _id: roleId, code: 'OPERATOR', name: 'Operator', permissions: [] });
      roleRepository.update.mockResolvedValue({ _id: roleId, code: 'OPERATOR', name: 'Updated', permissions: [] });
      roleRepository.addPermission.mockResolvedValue({ _id: roleId, code: 'OPERATOR', permissions: [permissionId] });
      roleRepository.removePermission.mockResolvedValue({ _id: roleId, code: 'OPERATOR', permissions: [] });
      roleRepository.deleteById.mockResolvedValue({ _id: roleId, code: 'OPERATOR', permissions: [] });
      permissionRepository.findByIds.mockImplementation(async (ids) => ids.map((id) => ({
        _id: id, code: 'ORDERS:READ',
      })));
      permissionRepository.findById.mockResolvedValue({ _id: permissionId, code: 'ORDERS:READ' });
      permissionRepository.findByCode.mockResolvedValue(null);
      permissionRepository.create.mockResolvedValue({ _id: permissionId, code: 'ORDERS:READ' });
      permissionRepository.update.mockResolvedValue({ _id: permissionId, code: 'ORDERS:WRITE' });
      permissionRepository.deleteById.mockResolvedValue({ _id: permissionId, code: 'ORDERS:READ' });
      scopeRegistryRepository.create.mockResolvedValue({
        _id: scopeRegistryId, scopeType: 'team', scopeId: teamId, name: 'Team', status: 'active',
      });
      scopeRegistryRepository.findById.mockResolvedValue({
        _id: scopeRegistryId, scopeType: 'team', scopeId: teamId, name: 'Team', status: 'active',
      });
      scopeRegistryRepository.update.mockResolvedValue({
        _id: scopeRegistryId, scopeType: 'team', scopeId: teamId, name: 'Updated', status: 'active',
      });
      accessAssignmentRepository.create.mockResolvedValue({
        _id: assignmentId, accountId, roleId, scopeType: 'team', scopeId: teamId,
        customPermissions: [], status: 'active',
      });
      accessAssignmentRepository.findById.mockResolvedValue({
        _id: assignmentId, accountId, roleId, scopeType: 'team', scopeId: teamId,
        customPermissions: [], status: 'active',
      });
      accessAssignmentRepository.update.mockResolvedValue({
        _id: assignmentId, accountId, roleId, scopeType: 'team', scopeId: teamId,
        customPermissions: [permissionId], status: 'active',
      });
      accessAssignmentRepository.deactivate.mockResolvedValue({
        _id: assignmentId, accountId, roleId, scopeType: 'team', scopeId: teamId,
        customPermissions: [], status: 'inactive',
      });
      scopedRolePermissionRepository.upsert.mockResolvedValue({
        _id: '660000000000000000000301', scopeType: 'team', scopeId: teamId,
        roleId, permissions: [permissionId],
      });
    });

    afterEach(() => {
      mongoose.startSession.mockRestore();
    });

    const accountCases = [
      ['ACCOUNT_CREATED', () => authAdmin.createAccount({
        email: 'new@example.com', password: 'never-store-this', assignments: [],
      }, actor, httpContext)],
      ['ACCOUNT_STATUS_UPDATED', () => authAdmin.updateAccountStatus(accountId, 'inactive', actor, httpContext)],
      ['ACCOUNT_EMAIL_UPDATED', () => authAdmin.updateAccountEmail(accountId, 'new@example.com', actor, httpContext)],
      ['ACCOUNT_PASSWORD_RESET', () => authAdmin.resetPassword(accountId, 'never-store-this', actor, httpContext)],
      ['ACCOUNT_SESSIONS_REVOKED', () => authAdmin.revokeAccountSessions(accountId, actor, httpContext)],
      ['ACCOUNT_ACCESS_UPDATED', () => authAdmin.updateAccountAccess(accountId, {
        roles: [roleId], customPermissions: [permissionId],
      }, actor, httpContext)],
      ['ACCOUNT_ARCHIVED', () => authAdmin.archiveAccount(accountId, actor, httpContext)],
    ];

    test.each(accountCases)('%s records a sanitized account mutation', async (action, invoke) => {
      await invoke();

      const [event, options] = auditPublic.record.mock.calls.at(-1);
      expect(event).toMatchObject({
        actorType: 'ACCOUNT', actorAccountId: actor.accountId, action,
        entityType: 'AUTH_ACCOUNT', entityId: accountId,
        outcome: 'SUCCEEDED', source: 'HTTP', requestId: httpContext.requestId,
      });
      expect(event.deduplicationKey).toMatch(new RegExp(`^auth-admin:${action.toLowerCase()}:[0-9a-f-]{36}$`));
      expect(options).toEqual({ session });
      expect(JSON.stringify(event)).not.toMatch(/never-store-this|new@example\.com|old@example\.com|passwordHash|passwordSalt/i);
      expect(event.changes).not.toHaveProperty('sessions');
    });

    const scopeCases = [
      ['AUTH_SCOPE_CREATED', () => authAdmin.createScope({ scopeType: 'team', scopeId: teamId, name: 'Team' }, actor, httpContext)],
      ['AUTH_SCOPE_UPDATED', () => authAdmin.updateScope(scopeRegistryId, { name: 'Updated' }, actor, httpContext)],
      ['AUTH_SCOPE_DEACTIVATED', () => authAdmin.deactivateScope(scopeRegistryId, actor, httpContext)],
    ];

    test.each(scopeCases)('%s records scope and changed fields', async (action, invoke) => {
      await invoke();

      expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
        actorType: 'ACCOUNT', actorAccountId: actor.accountId, action,
        entityType: 'AUTH_SCOPE', entityId: scopeRegistryId,
        scopeType: 'TEAM', scopeId: teamId, changes: expect.any(Object),
        outcome: 'SUCCEEDED', source: 'HTTP',
        deduplicationKey: expect.stringMatching(new RegExp(`^auth-admin:${action.toLowerCase()}:[0-9a-f-]{36}$`)),
      }), { session });
    });

    const assignmentCases = [
      ['ACCESS_ASSIGNMENT_CREATED', () => authAdmin.createAccessAssignment({
        accountId, roleId, scopeType: 'team', scopeId: teamId, customPermissions: [],
      }, actor, httpContext)],
      ['ACCESS_ASSIGNMENT_UPDATED', () => authAdmin.updateAccessAssignment(assignmentId, {
        customPermissions: [permissionId],
      }, actor, httpContext)],
      ['ACCESS_ASSIGNMENT_DEACTIVATED', () => authAdmin.deactivateAccessAssignment(assignmentId, actor, httpContext)],
    ];

    test.each(assignmentCases)('%s records assignment scope', async (action, invoke) => {
      await invoke();

      expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
        actorType: 'ACCOUNT', actorAccountId: actor.accountId, action,
        entityType: 'AUTH_ACCESS_ASSIGNMENT', entityId: assignmentId,
        scopeType: 'TEAM', scopeId: teamId, changes: expect.any(Object),
        outcome: 'SUCCEEDED', source: 'HTTP',
        deduplicationKey: expect.stringMatching(new RegExp(`^auth-admin:${action.toLowerCase()}:[0-9a-f-]{36}$`)),
      }), { session });
    });

    test('global assignments omit the incomplete audit scope pair', async () => {
      accessAssignmentRepository.create.mockResolvedValueOnce({
        _id: assignmentId, accountId, roleId, scopeType: 'global', scopeId: null,
        customPermissions: [], status: 'active',
      });

      await authAdmin.createAccessAssignment({
        accountId, roleId, scopeType: 'global', scopeId: null, customPermissions: [],
      }, actor, httpContext);

      expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
        scopeType: null, scopeId: null,
      }), { session });
    });

    test('SCOPED_ROLE_PERMISSIONS_SET records scoped permission identifiers without documents', async () => {
      await authAdmin.setScopedRolePermissions({
        scopeType: 'team', scopeId: teamId, roleId, permissionIds: [permissionId],
      }, actor, httpContext);

      const [event, options] = auditPublic.record.mock.calls.at(-1);
      expect(event).toMatchObject({
        actorType: 'ACCOUNT', actorAccountId: actor.accountId,
        action: 'SCOPED_ROLE_PERMISSIONS_SET', entityType: 'AUTH_SCOPED_ROLE_PERMISSION',
        scopeType: 'TEAM', scopeId: teamId,
        changes: { permissionIds: { after: [permissionId] } },
        outcome: 'SUCCEEDED', source: 'HTTP',
      });
      expect(event.entityId).toBe(`${teamId}:${roleId}`);
      expect(event.deduplicationKey).toMatch(/^auth-admin:scoped_role_permissions_set:/);
      expect(event).not.toHaveProperty('permissions');
      expect(options).toEqual({ session });
    });

    const roleCases = [
      ['ROLE_CREATED', () => authAdmin.createRole({ code: 'operator', name: 'Operator', permissions: [] }, actor, httpContext)],
      ['ROLE_UPDATED', () => authAdmin.updateRole(roleId, { name: 'Updated' }, actor, httpContext)],
      ['ROLE_PERMISSION_ADDED', () => authAdmin.addRolePermission(roleId, permissionId, actor, httpContext)],
      ['ROLE_PERMISSION_REMOVED', () => authAdmin.removeRolePermission(roleId, permissionId, actor, httpContext)],
      ['ROLE_DELETED', () => authAdmin.deleteRole(roleId, actor, httpContext)],
    ];

    test.each(roleCases)('%s records role mutation', async (action, invoke) => {
      await invoke();

      expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
        actorType: 'ACCOUNT', actorAccountId: actor.accountId, action,
        entityType: 'AUTH_ROLE', entityId: roleId, changes: expect.any(Object),
        outcome: 'SUCCEEDED', source: 'HTTP',
        deduplicationKey: expect.stringMatching(new RegExp(`^auth-admin:${action.toLowerCase()}:[0-9a-f-]{36}$`)),
      }), { session });
    });

    const permissionCases = [
      ['PERMISSION_CREATED', () => authAdmin.createPermission({ code: 'orders:read' }, actor, httpContext)],
      ['PERMISSION_UPDATED', () => authAdmin.updatePermission(permissionId, { code: 'orders:write' }, actor, httpContext)],
      ['PERMISSION_DELETED', () => authAdmin.deletePermission(permissionId, actor, httpContext)],
    ];

    test.each(permissionCases)('%s records permission mutation', async (action, invoke) => {
      await invoke();

      expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
        actorType: 'ACCOUNT', actorAccountId: actor.accountId, action,
        entityType: 'AUTH_PERMISSION', entityId: permissionId, changes: expect.any(Object),
        outcome: 'SUCCEEDED', source: 'HTTP',
        deduplicationKey: expect.stringMatching(new RegExp(`^auth-admin:${action.toLowerCase()}:[0-9a-f-]{36}$`)),
      }), { session });
    });

    test('programmatic mutations are audited as SYSTEM instead of bypassed', async () => {
      await authAdmin.createPermission({ code: 'orders:read' });

      expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
        actorType: 'SYSTEM', actorAccountId: null, source: 'SYSTEM',
        action: 'PERMISSION_CREATED', requestId: null,
      }), { session: expect.anything() });
    });

    test('syncScopeRegistry audits its programmatic upsert in the same transaction', async () => {
      scopeRegistryRepository.upsertByScope.mockResolvedValue({
        _id: scopeRegistryId, scopeType: 'team', scopeId: teamId, name: 'Synced', status: 'active',
      });

      await authAdmin.syncScopeRegistry({
        scopeType: 'team', scopeId: teamId, name: 'Synced', status: 'active',
      });

      expect(scopeRegistryRepository.upsertByScope).toHaveBeenCalledWith(expect.objectContaining({
        scopeType: 'team', scopeId: teamId, name: 'Synced', status: 'active',
      }), { session });
      expect(auditPublic.record).toHaveBeenLastCalledWith(expect.objectContaining({
        actorType: 'SYSTEM', source: 'SYSTEM', action: 'AUTH_SCOPE_SYNCED',
        entityType: 'AUTH_SCOPE', entityId: scopeRegistryId,
        scopeType: 'TEAM', scopeId: teamId, changes: expect.any(Object),
        deduplicationKey: expect.stringMatching(/^auth-admin:auth_scope_synced:[0-9a-f-]{36}$/),
      }), { session });
    });

    test('Mongo transaction callback replay reuses one server-owned deduplication key', async () => {
      session.withTransaction.mockImplementationOnce(async (callback) => {
        await callback();
        await callback();
      });

      await authAdmin.updateAccountStatus(accountId, 'inactive', actor, httpContext);

      const keys = auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey);
      expect(keys).toHaveLength(2);
      expect(new Set(keys).size).toBe(1);
    });
  });
});
