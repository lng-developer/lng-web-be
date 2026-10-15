function toAccountDto(account) {
  if (!account) {
    return null;
  }

  return {
    id: String(account._id || account.id),
    email: account.email,
    status: account.status,
    operatingCostAmount: account.operatingCostAmount || 0,
    operatingCostStartedAt: account.operatingCostStartedAt || null,
    deactivatedAt: account.deactivatedAt || null,
    mustChangePassword: Boolean(account.mustChangePassword),
    passwordSetupRequired: Boolean(account.passwordSetupRequired),
    authProvider: account.authProvider || 'LOCAL',
    avatarUrl: account.avatarUrl || null,
    lastLoginAt: account.lastLoginAt || null,
    lastLoginIp: account.lastLoginIp || null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function toAuthSessionDto({ accessToken, refreshToken, account, roles, permissions }) {
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    account: toAccountDto(account),
    roles,
    permissions,
  };
}

function toScopedAccessDto(scopedAccess = []) {
  return scopedAccess.map((scope) => ({
    assignmentId: String(scope.assignmentId || scope._id || scope.id),
    scopeType: scope.scopeType,
    scopeId: scope.scopeId ? String(scope.scopeId) : null,
    resourceId: scope.scopeId ? String(scope.scopeId) : null,
    roles: scope.roles || [],
    permissions: scope.permissions || [],
    ...(scope.validFrom ? { validFrom: scope.validFrom } : {}),
    ...(scope.validUntil ? { validUntil: scope.validUntil } : {}),
  }));
}

function toNonGlobalScopedAccessDto(scopedAccess = []) {
  return toScopedAccessDto(scopedAccess.filter((scope) => scope.scopeType !== 'global'));
}

function toAuthContextDto(authModel) {
  return {
    accountId: String(authModel.account._id),
    email: authModel.account.email,
    tokenVersion: Number(authModel.account.tokenVersion || 0),
    mustChangePassword: Boolean(authModel.account.mustChangePassword),
    passwordSetupRequired: Boolean(authModel.account.passwordSetupRequired),
    roles: authModel.roles,
    permissions: authModel.permissions,
    scopes: toScopedAccessDto(authModel.scopes),
  };
}

function toExtensionIdentityDto(shop) {
  return { tokenType: 'EXTENSION', shop: { id: String(shop._id), name: shop.name } };
}

module.exports = {
  toExtensionIdentityDto,
  toAccountDto,
  toAuthSessionDto,
  toScopedAccessDto,
  toNonGlobalScopedAccessDto,
  toAuthContextDto,
};
