const mongoose = require('mongoose');
const accountRepository = require('../../../modules/auth/repositories/account.repository');
const userProfileRepository = require('../../../modules/auth/repositories/userProfile.repository');
const roleRepository = require('../../../modules/auth/repositories/role.repository');
const permissionRepository = require('../../../modules/auth/repositories/permission.repository');
const accessAssignmentRepository = require('../../../modules/auth/repositories/accessAssignment.repository');
const scopeRegistryRepository = require('../../../modules/auth/repositories/scopeRegistry.repository');
const scopedRolePermissionRepository = require('../../../modules/auth/repositories/scopedRolePermission.repository');
const authManager = require('../../../modules/auth/services/authManager.service');
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

describe('authAdmin', () => {
  const accountId = '507f1f77bcf86cd799439011';
  const roleId = '507f1f77bcf86cd799439012';
  const permissionId = '507f1f77bcf86cd799439013';
  const teamId = '660000000000000000000101';

  beforeEach(() => {
    jest.clearAllMocks();
    accessAssignmentRepository.countByRole.mockResolvedValue(0);
    accessAssignmentRepository.countByCustomPermission.mockResolvedValue(0);
    accessAssignmentRepository.findAccountIdsByRole.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByRoles.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByCustomPermission.mockResolvedValue([]);
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
  });

  test('createAccount creates account and profile with explicit roles inside one transaction', async () => {
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    accountRepository.findByNormalizedEmail.mockResolvedValue(null);
    roleRepository.findByIds.mockResolvedValue([{ _id: roleId, code: 'ADMIN' }]);
    permissionRepository.findByIds.mockResolvedValue([]);
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
        scopeType: 'global',
        scopeId: null,
        customPermissionIds: [],
        roles: ['ADMIN'],
        permissions: ['AUTH:READ', 'AUTH:WRITE'],
      }],
    });

    const result = await authAdmin.createAccount({
      email: 'New.Admin@lng.co ',
      password: 'strong-password',
      fullName: 'New Admin',
      roles: [roleId],
      customPermissions: [],
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
      scopeType: 'global',
      scopeId: null,
      customPermissions: [],
      status: 'active',
    }], { session });
    expect(result.roles).toEqual(['ADMIN']);
    expect(session.endSession).toHaveBeenCalledTimes(1);

    mongoose.startSession.mockRestore();
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
        scopeType: 'global',
        scopeId: null,
        customPermissionIds: [],
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

  test('updatePermission invalidates accounts affected through custom permissions and roles', async () => {
    permissionRepository.findByCode.mockResolvedValue(null);
    permissionRepository.update.mockResolvedValue({ _id: permissionId, code: 'ORDERS:WRITE' });
    accessAssignmentRepository.findAccountIdsByCustomPermission.mockResolvedValue([{ accountId }]);
    roleRepository.findRoleIdsByPermission.mockResolvedValue([{ _id: roleId }]);
    scopedRolePermissionRepository.findRoleIdsByPermission.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByRoles.mockResolvedValue([{ accountId: '507f1f77bcf86cd799439015' }]);

    const result = await authAdmin.updatePermission(permissionId, { code: 'orders:write' });

    expect(result.code).toBe('ORDERS:WRITE');
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith('507f1f77bcf86cd799439015');
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
