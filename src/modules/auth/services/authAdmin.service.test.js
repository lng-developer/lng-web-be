const mongoose = require('mongoose');
const accountRepository = require('../repositories/account.repository');
const userProfileRepository = require('../repositories/userProfile.repository');
const roleRepository = require('../repositories/role.repository');
const permissionRepository = require('../repositories/permission.repository');
const accessAssignmentRepository = require('../repositories/accessAssignment.repository');
const scopeRegistryRepository = require('../repositories/scopeRegistry.repository');
const authManager = require('./authManager.service');
const authAdmin = require('./authAdmin.service');

jest.mock('../repositories/account.repository');
jest.mock('../repositories/userProfile.repository');
jest.mock('../repositories/role.repository');
jest.mock('../repositories/permission.repository');
jest.mock('../repositories/accessAssignment.repository');
jest.mock('../repositories/scopeRegistry.repository');
jest.mock('./authManager.service', () => ({
  invalidatePermissionCache: jest.fn(),
}));

describe('authAdmin', () => {
  const accountId = '507f1f77bcf86cd799439011';
  const roleId = '507f1f77bcf86cd799439012';
  const permissionId = '507f1f77bcf86cd799439013';

  beforeEach(() => {
    jest.clearAllMocks();
    accessAssignmentRepository.countByRole.mockResolvedValue(0);
    accessAssignmentRepository.countByCustomPermission.mockResolvedValue(0);
    accessAssignmentRepository.findAccountIdsByRole.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByRoles.mockResolvedValue([]);
    accessAssignmentRepository.findAccountIdsByCustomPermission.mockResolvedValue([]);
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
    accessAssignmentRepository.findAccountIdsByRoles.mockResolvedValue([{ accountId: '507f1f77bcf86cd799439015' }]);

    const result = await authAdmin.updatePermission(permissionId, { code: 'orders:write' });

    expect(result.code).toBe('ORDERS:WRITE');
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith(accountId);
    expect(authManager.invalidatePermissionCache).toHaveBeenCalledWith('507f1f77bcf86cd799439015');
  });
});
