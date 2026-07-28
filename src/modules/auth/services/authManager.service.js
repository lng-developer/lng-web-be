const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const config = require('../../../config');
const {
  hashString,
  hashPassword,
  verifyPassword,
  generateRandomToken,
} = require('../../../shared/utils/crypto');
const accountRepository = require('../repositories/account.repository');
const roleRepository = require('../repositories/role.repository');
const accessAssignmentRepository = require('../repositories/accessAssignment.repository');
const permissionRepository = require('../repositories/permission.repository');
const {
  toAccountDto,
  toScopedAccessDto,
  toNonGlobalScopedAccessDto,
  toAuthContextDto,
} = require('../dtos/auth.dto');
const {
  accountStatuses,
  roleCodes,
  accessAssignmentStatuses,
  accessScopeTypes,
} = require('../constants/auth.constants');

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function assertActiveAccount(account) {
  if (!account || account.status !== accountStatuses.ACTIVE) {
    throw new AppError('Invalid email or password', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }
}

function getRefreshTokenExpiresAt() {
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + config.auth.refreshTokenExpiresDays);
  return expiresAt;
}

function buildRefreshSession(refreshToken, { ipAddress, userAgent } = {}) {
  return {
    sessionId: generateRandomToken(16),
    refreshTokenHash: hashString(refreshToken),
    expiresAt: getRefreshTokenExpiresAt(),
    revokedAt: null,
    replacedBySessionId: null,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  };
}

function signAccessToken(authModel) {
  const context = buildAuthContext(authModel);

  return jwt.sign(
    {
      sub: context.accountId,
      email: context.email,
      tokenVersion: context.tokenVersion,
      roles: context.roles,
      permissions: context.permissions,
    },
    config.auth.jwtAccessSecret,
    {
      expiresIn: config.auth.jwtAccessExpiresIn,
    },
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.auth.jwtAccessSecret);
}

function buildAuthContext(accountAuthModel) {
  return toAuthContextDto(accountAuthModel);
}

async function enrichWithScopedAccess(authModel) {
  if (!authModel || !authModel.account) {
    return authModel;
  }

  return {
    ...authModel,
    roles: authModel.roles || [],
    permissions: authModel.permissions || [],
    scopes: authModel.scopes || [],
  };
}

function toAuthResponse({ accessToken, refreshToken, authModel }) {
  return {
    accessToken,
    refreshToken,
    account: toAccountDto(authModel.account),
    roles: authModel.roles,
    permissions: authModel.permissions,
    scopes: toNonGlobalScopedAccessDto(authModel.scopes),
  };
}

async function register(email, password, defaultRoleCode = roleCodes.USER) {
  const normalizedEmail = normalizeEmail(email);
  const existingAccount = await accountRepository.findByEmail(normalizedEmail);

  if (existingAccount) {
    throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  const defaultRole = await roleRepository.findByCode(defaultRoleCode);

  if (!defaultRole) {
    throw new AppError('Default role is not configured', httpStatus.INTERNAL_SERVER, false, errorCodes.INTERNAL_SERVER_ERROR);
  }

  const { passwordHash, passwordSalt } = await hashPassword(password);
  const session = await mongoose.startSession();

  try {
    let account;
    await session.withTransaction(async () => {
      account = await accountRepository.create({
        email: normalizedEmail,
        passwordHash,
        passwordSalt,
        sessions: [],
        status: accountStatuses.ACTIVE,
      }, { session });

      await accessAssignmentRepository.create({
        accountId: account._id,
        roleId: defaultRole._id,
        scopeType: accessScopeTypes.GLOBAL,
        scopeId: null,
        status: accessAssignmentStatuses.ACTIVE,
      }, { session });
    });

    return {
      account: toAccountDto(account),
    };
  } catch (error) {
    if (error && error.code === 11000) {
      throw new AppError('Email is already in use', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

async function findAuthModelByIdentifier(identifier) {
  const normalized = String(identifier).trim();
  if (normalized.includes('@')) {
    return accountRepository.findAuthAccountByEmail(normalizeEmail(normalized));
  }

  // Lazy public-port lookup avoids the Auth <-> HR CommonJS initialization cycle.
  const hrPublic = require('../../hr/public');
  const profile = await hrPublic.getEmployeeProfileByEmployeeCode(normalized);
  return profile?.accountId
    ? accountRepository.findAuthAccountById(profile.accountId)
    : null;
}

async function login(identifier, password, ipAddress, userAgent) {
  const authModel = await enrichWithScopedAccess(
    await findAuthModelByIdentifier(identifier),
  );

  if (!authModel) {
    throw new AppError('Invalid email or password', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }

  assertActiveAccount(authModel.account);

  const passwordMatches = await verifyPassword(password, authModel.account.passwordHash, authModel.account.passwordSalt);

  if (!passwordMatches) {
    throw new AppError('Invalid email or password', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }

  const accessToken = signAccessToken(authModel);
  const refreshToken = generateRandomToken(48);
  const refreshSession = buildRefreshSession(refreshToken, { ipAddress, userAgent });

  await accountRepository.appendSession(authModel.account._id, refreshSession);
  await accountRepository.updateLastLogin(authModel.account._id, ipAddress);

  return toAuthResponse({
    accessToken,
    refreshToken,
    authModel,
  });
}

async function refreshSession(refreshToken, ipAddress, userAgent) {
  const refreshTokenHash = hashString(refreshToken);
  const account = await accountRepository.findAccountByActiveRefreshToken(refreshTokenHash);

  if (!account) {
    throw new AppError('Invalid refresh token', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }

  const authModel = await enrichWithScopedAccess(
    await accountRepository.findAuthAccountById(account._id),
  );

  if (!authModel || authModel.account.status !== accountStatuses.ACTIVE) {
    throw new AppError('Invalid refresh token', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }

  const nextRefreshToken = generateRandomToken(48);
  const nextSessionData = buildRefreshSession(nextRefreshToken, { ipAddress, userAgent });
  const rotatedAccount = await accountRepository.rotateRefreshSession(refreshTokenHash, nextSessionData);

  if (!rotatedAccount) {
    throw new AppError('Invalid refresh token', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }

  return toAuthResponse({
    accessToken: signAccessToken(authModel),
    refreshToken: nextRefreshToken,
    authModel,
  });
}

async function logout(refreshToken) {
  await accountRepository.revokeRefreshSession(hashString(refreshToken));
}

async function getCurrentAccount(accountId, expectedTokenVersion = undefined) {
  const authModel = await enrichWithScopedAccess(
    await accountRepository.findAuthAccountById(accountId),
  );

  if (!authModel || authModel.account.status !== accountStatuses.ACTIVE) {
    throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }

  if (
    expectedTokenVersion !== undefined
    && Number(expectedTokenVersion || 0) !== Number(authModel.account.tokenVersion || 0)
  ) {
    throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }

  return authModel;
}

async function invalidatePermissionCache(accountId) {
  await accountRepository.invalidatePermissionCache(accountId);
}

async function filterAssignableAccountIds(accountIds = [], requiredPermission) {
  const active = await accountRepository.findActiveByIds(accountIds);
  if (!requiredPermission) return active.map((account) => String(account._id));

  // ponytail: bounded N+1 over at most 100 picker candidates; aggregate if picker limits grow.
  const permission = String(requiredPermission).trim().toUpperCase();
  const models = await Promise.all(active.map((account) => accountRepository.findAuthAccountById(account._id)));
  return models.flatMap((model, index) => {
    const permissions = [
      ...(model?.permissions || []),
      ...(model?.scopes || []).flatMap((scope) => scope.permissions || []),
    ];
    return permissions.includes(permission) ? [String(active[index]._id)] : [];
  });
}

async function listMigrationAccounts() {
  return accountRepository.listMigrationAccounts();
}

async function hasPermissionCodes(codes = []) {
  const permissions = await permissionRepository.listByCodes(codes);
  return permissions.length === [...new Set(codes)].length;
}

module.exports = {
  normalizeEmail,
  register,
  login,
  refreshSession,
  logout,
  getCurrentAccount,
  verifyAccessToken,
  buildAuthContext,
  invalidatePermissionCache,
  filterAssignableAccountIds,
  listMigrationAccounts,
  hasPermissionCodes,
};
