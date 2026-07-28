const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const logger = require('../../../shared/utils/logger');
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

const DUMMY_PASSWORD_HASH = 'dcc815c2ea22549222707bf40bf990ea81714f9ee09b7bcb3cbafcac854853829b50566b8f30187ba3f34944148867bf039c2fd685be8f4f3e2e886f7c299063';
const DUMMY_PASSWORD_SALT = 'c844cf78579777a93277c3213aeb5c26';

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function getAuditPublic() {
  // Lazy load avoids the Auth <-> Audit CommonJS initialization cycle.
  return require('../../audit/public');
}

async function recordAuthEvent(operation, event, httpContext = {}, operationId, { session } = {}) {
  const requestId = httpContext.requestId || null;
  return getAuditPublic().record({
    ...event,
    source: 'HTTP',
    requestId,
    ipAddress: httpContext.ipAddress || null,
    userAgent: httpContext.userAgent || null,
    metadata: event.metadata || {},
    deduplicationKey: `auth:${operation}:${operationId || generateRandomToken(16)}`,
  }, session ? { session } : {});
}

function authenticationError(message) {
  return new AppError(message, httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
}

async function tryRecordFailedAuthentication(operation, event, httpContext, operationId) {
  try {
    await recordAuthEvent(operation, event, httpContext, operationId);
  } catch (auditError) {
    logger.warn('auth_failure_audit_failed', { requestId: httpContext?.requestId, error: auditError });
  }
}

async function rejectAuthentication(message, operation, event, httpContext) {
  await tryRecordFailedAuthentication(operation, event, httpContext);
  throw authenticationError(message);
}

async function withAuthTransaction(callback) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result;
  } finally {
    await session.endSession();
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

async function login(identifier, password, httpContext = {}) {
  const authModel = await enrichWithScopedAccess(
    await findAuthModelByIdentifier(identifier),
  );

  if (!authModel || authModel.account.status !== accountStatuses.ACTIVE) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH, DUMMY_PASSWORD_SALT);
    await rejectAuthentication('Invalid email or password', 'login', {
      actorType: 'ANONYMOUS',
      actorAccountId: null,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'AUTH_ACCOUNT',
      entityId: 'UNKNOWN',
      outcome: 'FAILED',
      metadata: { reason: 'INVALID_CREDENTIALS' },
    }, httpContext);
  }

  const passwordMatches = await verifyPassword(password, authModel.account.passwordHash, authModel.account.passwordSalt);

  if (!passwordMatches) {
    await rejectAuthentication('Invalid email or password', 'login', {
      actorType: 'ANONYMOUS',
      actorAccountId: null,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'AUTH_ACCOUNT',
      entityId: 'UNKNOWN',
      outcome: 'FAILED',
      metadata: { reason: 'INVALID_CREDENTIALS' },
    }, httpContext);
  }

  const accessToken = signAccessToken(authModel);
  const refreshToken = generateRandomToken(48);
  const refreshSession = buildRefreshSession(refreshToken, httpContext);

  await withAuthTransaction(async (session) => {
    await accountRepository.appendSession(authModel.account._id, refreshSession, { session });
    await accountRepository.updateLastLogin(authModel.account._id, httpContext.ipAddress, { session });
    await recordAuthEvent('login', {
      actorType: 'ACCOUNT',
      actorAccountId: String(authModel.account._id),
      action: 'AUTH_LOGIN_SUCCEEDED',
      entityType: 'AUTH_ACCOUNT',
      entityId: String(authModel.account._id),
      outcome: 'SUCCEEDED',
    }, httpContext, refreshSession.sessionId, { session });
  });

  return toAuthResponse({
    accessToken,
    refreshToken,
    authModel,
  });
}

async function refreshSession(refreshToken, httpContext = {}) {
  const refreshTokenHash = hashString(refreshToken);
  const nextRefreshToken = generateRandomToken(48);
  const nextSessionData = buildRefreshSession(nextRefreshToken, httpContext);
  const failedAuditOperationId = generateRandomToken(16);
  let result = { status: 'UNKNOWN' };
  await withAuthTransaction(async (session) => {
    result = { status: 'UNKNOWN' };
    const account = await accountRepository.findAccountByRefreshToken(refreshTokenHash, { session });
    const matchedSession = findRefreshSession(account, refreshTokenHash);
    if (!account || !matchedSession) return;

    const accountId = String(account._id);
    if (matchedSession.revokedAt || matchedSession.replacedBySessionId) {
      await accountRepository.revokeRefreshSessionFamily(
        account._id,
        refreshSessionFamilyIds(account, matchedSession),
        { session },
      );
      result = { status: 'REPLAYED', accountId };
      return;
    }

    if (account.status !== accountStatuses.ACTIVE) {
      result = { status: 'ACCOUNT_INACTIVE', accountId };
      return;
    }
    if (!matchedSession.expiresAt || new Date(matchedSession.expiresAt) <= new Date()) {
      result = { status: 'INVALID_REFRESH_TOKEN', accountId };
      return;
    }

    const rotatedAccount = await accountRepository.rotateRefreshSession(
      refreshTokenHash,
      nextSessionData,
      { session },
    );
    if (!rotatedAccount) {
      result = { status: 'SESSION_ROTATION_FAILED', accountId };
      return;
    }
    await recordAuthEvent('refresh', {
      actorType: 'ACCOUNT',
      actorAccountId: accountId,
      action: 'AUTH_SESSION_REFRESHED',
      entityType: 'AUTH_SESSION',
      entityId: nextSessionData.sessionId,
      outcome: 'SUCCEEDED',
    }, httpContext, nextSessionData.sessionId, { session });
    result = {
      status: 'ROTATED',
      accountId,
      tokenVersion: Number(account.tokenVersion || 0),
    };
  });

  if (result.status === 'UNKNOWN') {
    await rejectAuthentication('Invalid refresh token', 'refresh', {
      actorType: 'ANONYMOUS',
      actorAccountId: null,
      action: 'AUTH_SESSION_REFRESHED',
      entityType: 'AUTH_SESSION',
      entityId: 'UNKNOWN',
      outcome: 'FAILED',
      metadata: { reason: 'INVALID_REFRESH_TOKEN' },
    }, httpContext);
  }
  if (result.status === 'REPLAYED') {
    await tryRecordFailedAuthentication('refresh', {
      actorType: 'ACCOUNT',
      actorAccountId: result.accountId,
      action: 'AUTH_SESSION_REFRESHED',
      entityType: 'AUTH_ACCOUNT',
      entityId: result.accountId,
      outcome: 'FAILED',
      metadata: { reason: 'REFRESH_TOKEN_REUSED' },
    }, httpContext, failedAuditOperationId);
    throw authenticationError('Invalid refresh token');
  }
  if (result.status !== 'ROTATED') {
    await rejectAuthentication('Invalid refresh token', 'refresh', {
      actorType: 'ACCOUNT',
      actorAccountId: result.accountId,
      action: 'AUTH_SESSION_REFRESHED',
      entityType: 'AUTH_ACCOUNT',
      entityId: result.accountId,
      outcome: 'FAILED',
      metadata: { reason: result.status },
    }, httpContext);
  }

  const authModel = await enrichWithScopedAccess(
    await accountRepository.findAuthAccountById(result.accountId),
  );
  if (!authModel) throw authenticationError('Invalid refresh token');
  const accessTokenAuthModel = {
    ...authModel,
    account: {
      ...authModel.account,
      tokenVersion: result.tokenVersion,
    },
  };

  return toAuthResponse({
    accessToken: signAccessToken(accessTokenAuthModel),
    refreshToken: nextRefreshToken,
    authModel,
  });
}

async function logout(refreshToken, httpContext = {}) {
  const refreshTokenHash = hashString(refreshToken);
  const auditOperationId = generateRandomToken(16);
  let outcome = 'UNKNOWN';
  let replayAccountId = null;
  await withAuthTransaction(async (session) => {
    outcome = 'UNKNOWN';
    replayAccountId = null;
    const revokedAccount = await accountRepository.revokeRefreshSessionAndReturn(
      refreshTokenHash,
      { session },
    );
    if (revokedAccount) {
      const accountId = String(revokedAccount._id);
      await recordAuthEvent('logout', {
        actorType: 'ACCOUNT',
        actorAccountId: accountId,
        action: 'AUTH_LOGOUT',
        entityType: 'AUTH_ACCOUNT',
        entityId: accountId,
        outcome: 'SUCCEEDED',
      }, httpContext, auditOperationId, { session });
      outcome = 'REVOKED';
      return;
    }

    const account = await accountRepository.findAccountByRefreshToken(refreshTokenHash, { session });
    const matchedSession = findRefreshSession(account, refreshTokenHash);
    if (!account || !matchedSession) return;
    const accountId = String(account._id);
    await accountRepository.revokeRefreshSessionFamily(
      account._id,
      refreshSessionFamilyIds(account, matchedSession),
      { session },
    );
    outcome = 'REPLAYED';
    replayAccountId = accountId;
  });

  if (outcome === 'REPLAYED') {
    await tryRecordFailedAuthentication('logout', {
      actorType: 'ACCOUNT',
      actorAccountId: replayAccountId,
      action: 'AUTH_LOGOUT',
      entityType: 'AUTH_ACCOUNT',
      entityId: replayAccountId,
      outcome: 'FAILED',
      metadata: { reason: 'REFRESH_TOKEN_REUSED' },
    }, httpContext, auditOperationId);
  }
  if (outcome === 'UNKNOWN') {
    await tryRecordFailedAuthentication('logout', {
      actorType: 'ANONYMOUS',
      actorAccountId: null,
      action: 'AUTH_LOGOUT',
      entityType: 'AUTH_SESSION',
      entityId: 'UNKNOWN',
      outcome: 'FAILED',
      metadata: { reason: 'INVALID_REFRESH_TOKEN' },
    }, httpContext);
  }
}

function findRefreshSession(account, refreshTokenHash) {
  return (account?.sessions || []).find((entry) => entry.refreshTokenHash === refreshTokenHash) || null;
}

function refreshSessionFamilyIds(account, firstSession) {
  const sessionsById = new Map((account.sessions || []).map((entry) => [entry.sessionId, entry]));
  const familyIds = [];
  const visited = new Set();
  let current = firstSession;
  while (current?.sessionId && !visited.has(current.sessionId)) {
    familyIds.push(current.sessionId);
    visited.add(current.sessionId);
    current = current.replacedBySessionId ? sessionsById.get(current.replacedBySessionId) : null;
  }
  return familyIds;
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
