function toAccountDto(account) {
  if (!account) {
    return null;
  }

  return {
    id: String(account._id || account.id),
    email: account.email,
    status: account.status,
    lastLoginAt: account.lastLoginAt || null,
    lastLoginIp: account.lastLoginIp || null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function toProfileDto(profile) {
  if (!profile) {
    return null;
  }

  return {
    id: String(profile._id || profile.id),
    accountId: String(profile.accountId),
    email: profile.email,
    fullName: profile.fullName,
    employeeCode: profile.employeeCode || null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function toAuthSessionDto({ accessToken, refreshToken, account, profile, roles, permissions }) {
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    account: toAccountDto(account),
    profile: toProfileDto(profile),
    roles,
    permissions,
  };
}

function toScopedAccessDto(scopedAccess = []) {
  return scopedAccess.map((scope) => ({
    assignmentId: String(scope.assignmentId || scope._id || scope.id),
    scopeType: scope.scopeType,
    scopeId: scope.scopeId ? String(scope.scopeId) : null,
    roles: scope.roles || [],
    permissions: scope.permissions || [],
  }));
}

function toAuthContextDto(authModel) {
  return {
    accountId: String(authModel.account._id),
    profileId: authModel.profile ? String(authModel.profile._id) : null,
    email: authModel.account.email,
    tokenVersion: Number(authModel.account.tokenVersion || 0),
    roles: authModel.roles,
    permissions: authModel.permissions,
    scopes: toScopedAccessDto(authModel.scopes),
  };
}

module.exports = {
  toAccountDto,
  toProfileDto,
  toAuthSessionDto,
  toScopedAccessDto,
  toAuthContextDto,
};
