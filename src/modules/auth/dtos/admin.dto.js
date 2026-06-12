const { toAccountDto, toProfileDto } = require('./auth.dto');

function toRoleDto(role) {
  if (!role) {
    return null;
  }

  return {
    id: String(role._id || role.id),
    name: role.name,
    code: role.code,
    permissions: (role.permissions || []).map((permissionId) => String(permissionId)),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function toPermissionDto(permission) {
  if (!permission) {
    return null;
  }

  return {
    id: String(permission._id || permission.id),
    code: permission.code,
    createdAt: permission.createdAt,
    updatedAt: permission.updatedAt,
  };
}

function toAccessDto(account = {}) {
  return {
    roleIds: (account.roles || []).map((roleId) => String(roleId)),
    customPermissionIds: (account.customPermissions || []).map((permissionId) => String(permissionId)),
  };
}

function toAccountListDto(account) {
  return {
    ...toAccountDto(account),
    access: toAccessDto(account),
  };
}

function toAccountAdminDto({ account, profile, roles, permissions } = {}) {
  return {
    account: toAccountDto(account),
    profile: toProfileDto(profile),
    access: toAccessDto(account),
    roles,
    permissions,
  };
}

function toAccessAssignmentDto(assignment) {
  if (!assignment) {
    return null;
  }

  return {
    id: String(assignment._id || assignment.id),
    accountId: String(assignment.accountId),
    roleId: String(assignment.roleId),
    scopeType: assignment.scopeType,
    scopeId: assignment.scopeId ? String(assignment.scopeId) : null,
    customPermissionIds: (assignment.customPermissions || []).map((permissionId) => String(permissionId)),
    status: assignment.status,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

module.exports = {
  toRoleDto,
  toPermissionDto,
  toAccountListDto,
  toAccountAdminDto,
  toAccessAssignmentDto,
};
