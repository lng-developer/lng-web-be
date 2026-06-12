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

module.exports = {
  toRoleDto,
  toPermissionDto,
  toAccountListDto,
  toAccountAdminDto,
};
