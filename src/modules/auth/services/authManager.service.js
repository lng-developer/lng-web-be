const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const https = require('https');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
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

function getOrganizationPublic() {
  return require('../../organization/public');
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
    tokenType: 'Bearer',
    account: toAccountDto(authModel.account),
    roles: authModel.roles,
    permissions: authModel.permissions,
    scopes: toNonGlobalScopedAccessDto(authModel.scopes),
  };
}

async function register(email, password, defaultRoleCode = roleCodes.USER, httpContext = {}) {
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

      await recordAuthEvent('register', {
        actorType: 'ACCOUNT',
        actorAccountId: String(account._id),
        action: 'ACCOUNT_CREATED',
        entityType: 'AUTH_ACCOUNT',
        entityId: String(account._id),
        outcome: 'SUCCEEDED',
      }, httpContext, String(account._id), { session });
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
    ? accountRepository.findAuthAccountById(profile.accountId, { includePassword: true })
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

let googleOAuthClient = null;

function setGoogleOAuthClient(client) {
  googleOAuthClient = client;
}

function getGoogleOAuthClient() {
  if (!googleOAuthClient) {
    googleOAuthClient = new OAuth2Client(config.auth.googleClientId || undefined);
  }
  return googleOAuthClient;
}

async function verifyGoogleCredential(credential) {
  const idToken = typeof credential === 'string' ? credential : credential?.idToken;
  const accessToken = typeof credential === 'object' ? credential?.accessToken : undefined;

  try {
    const client = getGoogleOAuthClient();

    if (idToken) {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: config.auth.googleClientId || undefined,
      });
      return ticket.getPayload();
    }

    if (accessToken) {
      const tokenInfo = await client.getTokenInfo(accessToken);
      if (config.auth.googleClientId && tokenInfo.aud !== config.auth.googleClientId) {
        throw new Error('Token audience mismatch');
      }
      const userinfoRes = await client.request({
        url: 'https://www.googleapis.com/oauth2/v3/userinfo',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return userinfoRes.data;
    }

    throw new Error('Neither idToken nor accessToken provided');
  } catch (err) {
    logger.warn('google_credential_verification_failed', { error: err?.message });
    throw authenticationError('Xác thực tài khoản Google không hợp lệ hoặc đã hết hạn');
  }
}

async function loginWithGoogle(credential, httpContext = {}) {
  const payload = await verifyGoogleCredential(credential);

  if (!payload || !payload.email) {
    throw new AppError('Google profile does not contain an email', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  if (!payload.email_verified) {
    await rejectAuthentication('Email Google chưa được xác thực', 'google-login', {
      actorType: 'ANONYMOUS',
      actorAccountId: null,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'AUTH_ACCOUNT',
      entityId: 'UNKNOWN',
      outcome: 'FAILED',
      metadata: { reason: 'EMAIL_NOT_VERIFIED', provider: 'GOOGLE' },
    }, httpContext);
  }

  const normalizedEmail = normalizeEmail(payload.email);
  const googleId = payload.sub;

  let authModel = await enrichWithScopedAccess(
    await accountRepository.findAuthAccountByGoogleId(googleId),
  );

  if (!authModel) {
    authModel = await enrichWithScopedAccess(
      await accountRepository.findAuthAccountByEmail(normalizedEmail),
    );

    if (authModel) {
      await accountRepository.linkGoogleAccount(authModel.account._id, {
        googleId,
        avatarUrl: payload.picture || null,
      });
      authModel = await enrichWithScopedAccess(
        await accountRepository.findAuthAccountById(authModel.account._id, { includePassword: false }),
      );
    }
  }

  if (!authModel) {
    if (!config.auth.registerEnabled) {
      await rejectAuthentication('Tài khoản chưa được kích hoạt trên hệ thống. Vui lòng liên hệ quản trị viên.', 'google-login', {
        actorType: 'ANONYMOUS',
        actorAccountId: null,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'AUTH_ACCOUNT',
        entityId: 'UNKNOWN',
        outcome: 'FAILED',
        metadata: { reason: 'ACCOUNT_NOT_FOUND', email: normalizedEmail, provider: 'GOOGLE' },
      }, httpContext);
    }

    const defaultRole = await roleRepository.findByCode(roleCodes.USER);
    if (!defaultRole) {
      throw new AppError('Default role is not configured', httpStatus.INTERNAL_SERVER, false, errorCodes.INTERNAL_SERVER_ERROR);
    }

    const session = await mongoose.startSession();
    let createdAccount;
    try {
      await session.withTransaction(async () => {
        createdAccount = await accountRepository.create({
          email: normalizedEmail,
          googleId,
          authProvider: 'GOOGLE',
          avatarUrl: payload.picture || null,
          sessions: [],
          status: accountStatuses.ACTIVE,
        }, { session });

        await accessAssignmentRepository.create({
          accountId: createdAccount._id,
          roleId: defaultRole._id,
          scopeType: accessScopeTypes.GLOBAL,
          scopeId: null,
          status: accessAssignmentStatuses.ACTIVE,
        }, { session });

        await recordAuthEvent('register-google', {
          actorType: 'ACCOUNT',
          actorAccountId: String(createdAccount._id),
          action: 'ACCOUNT_CREATED',
          entityType: 'AUTH_ACCOUNT',
          entityId: String(createdAccount._id),
          outcome: 'SUCCEEDED',
          metadata: { provider: 'GOOGLE', googleId },
        }, httpContext, String(createdAccount._id), { session });
      });
    } catch (createErr) {
      if (createErr && createErr.code === 11000) {
        authModel = await enrichWithScopedAccess(
          await accountRepository.findAuthAccountByEmail(normalizedEmail),
        );
      } else {
        throw createErr;
      }
    } finally {
      await session.endSession();
    }

    if (!authModel && createdAccount) {
      authModel = await enrichWithScopedAccess(
        await accountRepository.findAuthAccountById(createdAccount._id, { includePassword: false }),
      );
    }
  }

  if (!authModel || authModel.account.status !== accountStatuses.ACTIVE) {
    await rejectAuthentication('Tài khoản của bạn đã bị khóa hoặc chưa kích hoạt', 'google-login', {
      actorType: 'ANONYMOUS',
      actorAccountId: authModel ? String(authModel.account._id) : null,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'AUTH_ACCOUNT',
      entityId: authModel ? String(authModel.account._id) : 'UNKNOWN',
      outcome: 'FAILED',
      metadata: { reason: 'ACCOUNT_INACTIVE', provider: 'GOOGLE' },
    }, httpContext);
  }

  const accessToken = signAccessToken(authModel);
  const refreshToken = generateRandomToken(48);
  const refreshSession = buildRefreshSession(refreshToken, httpContext);

  await withAuthTransaction(async (session) => {
    await accountRepository.appendSession(authModel.account._id, refreshSession, { session });
    await accountRepository.updateLastLogin(authModel.account._id, httpContext.ipAddress, { session });
    await recordAuthEvent('google-login', {
      actorType: 'ACCOUNT',
      actorAccountId: String(authModel.account._id),
      action: 'AUTH_LOGIN_SUCCEEDED',
      entityType: 'AUTH_ACCOUNT',
      entityId: String(authModel.account._id),
      outcome: 'SUCCEEDED',
      metadata: { provider: 'GOOGLE', googleId },
    }, httpContext, refreshSession.sessionId, { session });
  });

  return toAuthResponse({
    accessToken,
    refreshToken,
    authModel,
  });
}

let msJwksCache = { keys: [], expiresAt: 0 };
let msTokenVerifier = null;

function setMicrosoftJwksClient() {}

function setMicrosoftTokenVerifier(verifier) {
  msTokenVerifier = verifier;
}

async function fetchMicrosoftJwks(tenant = 'common') {
  const now = Date.now();
  if (msJwksCache.keys.length > 0 && msJwksCache.expiresAt > now) {
    return msJwksCache.keys;
  }
  return new Promise((resolve, reject) => {
    const url = `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`;
    https.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Failed to fetch Microsoft JWKS: HTTP ${res.statusCode}`));
      }
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          const keys = Array.isArray(parsed.keys) ? parsed.keys : [];
          msJwksCache = {
            keys,
            expiresAt: now + 3600 * 1000,
          };
          resolve(keys);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function getMicrosoftSigningKey(kid) {
  const tenant = config.auth.microsoftTenantId || 'common';
  let keys = await fetchMicrosoftJwks(tenant);
  let keyMatch = keys.find((k) => k.kid === kid);

  if (!keyMatch) {
    msJwksCache.expiresAt = 0;
    keys = await fetchMicrosoftJwks(tenant);
    keyMatch = keys.find((k) => k.kid === kid);
    if (!keyMatch) {
      throw new Error(`Signing key for kid "${kid}" not found in Microsoft JWKS`);
    }
  }

  return crypto.createPublicKey({ key: keyMatch, format: 'jwk' });
}

async function verifyMicrosoftIdToken(idToken) {
  try {
    if (typeof msTokenVerifier === 'function') {
      return await msTokenVerifier(idToken);
    }

    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
      throw new Error('Token Microsoft không đúng định dạng');
    }

    const signingKey = await getMicrosoftSigningKey(decoded.header.kid);

    const verifyOptions = {};
    if (config.auth.microsoftClientId) {
      verifyOptions.audience = config.auth.microsoftClientId;
    }

    return jwt.verify(idToken, signingKey, verifyOptions);
  } catch (err) {
    logger.warn('microsoft_id_token_verification_failed', { error: err?.message });
    throw authenticationError('Xác thực tài khoản Microsoft không hợp lệ hoặc đã hết hạn');
  }
}

async function loginWithMicrosoft(idToken, httpContext = {}) {
  const payload = await verifyMicrosoftIdToken(idToken);

  const rawEmail = payload.email || payload.preferred_username || payload.upn;
  if (!rawEmail) {
    throw new AppError('Microsoft profile does not contain an email', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  const normalizedEmail = normalizeEmail(rawEmail);
  const microsoftId = payload.oid || payload.sub;

  const allowedDomain = (config.auth.microsoftAllowedDomain || 'lngwork.co').toLowerCase();
  const emailDomain = normalizedEmail.split('@')[1];

  if (emailDomain !== allowedDomain) {
    await rejectAuthentication(
      `Chỉ cho phép tài khoản Microsoft thuộc tổ chức @${allowedDomain}`,
      'microsoft-login',
      {
        actorType: 'ANONYMOUS',
        actorAccountId: null,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'AUTH_ACCOUNT',
        entityId: 'UNKNOWN',
        outcome: 'FAILED',
        metadata: { reason: 'DOMAIN_NOT_ALLOWED', email: normalizedEmail, provider: 'MICROSOFT' },
      },
      httpContext,
    );
  }

  let authModel = await enrichWithScopedAccess(
    await accountRepository.findAuthAccountByMicrosoftId(microsoftId),
  );

  if (!authModel) {
    authModel = await enrichWithScopedAccess(
      await accountRepository.findAuthAccountByEmail(normalizedEmail),
    );

    if (authModel) {
      await accountRepository.linkMicrosoftAccount(authModel.account._id, {
        microsoftId,
        avatarUrl: payload.picture || null,
      });
      authModel = await enrichWithScopedAccess(
        await accountRepository.findAuthAccountById(authModel.account._id, { includePassword: false }),
      );
    }
  }

  if (!authModel) {
    if (!config.auth.registerEnabled && !config.auth.microsoftAutoProvision) {
      await rejectAuthentication('Tài khoản chưa được kích hoạt trên hệ thống. Vui lòng liên hệ quản trị viên.', 'microsoft-login', {
        actorType: 'ANONYMOUS',
        actorAccountId: null,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'AUTH_ACCOUNT',
        entityId: 'UNKNOWN',
        outcome: 'FAILED',
        metadata: { reason: 'ACCOUNT_NOT_FOUND', email: normalizedEmail, provider: 'MICROSOFT' },
      }, httpContext);
    }

    const defaultRole = await roleRepository.findByCode(roleCodes.USER);
    if (!defaultRole) {
      throw new AppError('Default role is not configured', httpStatus.INTERNAL_SERVER, false, errorCodes.INTERNAL_SERVER_ERROR);
    }

    const session = await mongoose.startSession();
    let createdAccount;
    try {
      await session.withTransaction(async () => {
        createdAccount = await accountRepository.create({
          email: normalizedEmail,
          microsoftId,
          authProvider: 'MICROSOFT',
          avatarUrl: payload.picture || null,
          sessions: [],
          status: accountStatuses.ACTIVE,
        }, { session });

        await accessAssignmentRepository.create({
          accountId: createdAccount._id,
          roleId: defaultRole._id,
          scopeType: accessScopeTypes.GLOBAL,
          scopeId: null,
          status: accessAssignmentStatuses.ACTIVE,
        }, { session });

        await recordAuthEvent('register-microsoft', {
          actorType: 'ACCOUNT',
          actorAccountId: String(createdAccount._id),
          action: 'ACCOUNT_CREATED',
          entityType: 'AUTH_ACCOUNT',
          entityId: String(createdAccount._id),
          outcome: 'SUCCEEDED',
          metadata: { provider: 'MICROSOFT', microsoftId },
        }, httpContext, String(createdAccount._id), { session });
      });
    } catch (createErr) {
      if (createErr && createErr.code === 11000) {
        authModel = await enrichWithScopedAccess(
          await accountRepository.findAuthAccountByEmail(normalizedEmail),
        );
        if (!authModel) {
          logger.error('auth_microsoft_provision_duplicate_key_unresolved', {
            email: normalizedEmail,
            error: createErr.message,
            keyPattern: createErr.keyPattern,
          });
          throw createErr;
        }
      } else {
        throw createErr;
      }
    } finally {
      await session.endSession();
    }

    if (!authModel && createdAccount) {
      authModel = await enrichWithScopedAccess(
        await accountRepository.findAuthAccountById(createdAccount._id, { includePassword: false }),
      );
    }
  }

  if (!authModel || authModel.account.status !== accountStatuses.ACTIVE) {
    await rejectAuthentication('Tài khoản của bạn đã bị khóa hoặc chưa kích hoạt', 'microsoft-login', {
      actorType: 'ANONYMOUS',
      actorAccountId: authModel ? String(authModel.account._id) : null,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'AUTH_ACCOUNT',
      entityId: authModel ? String(authModel.account._id) : 'UNKNOWN',
      outcome: 'FAILED',
      metadata: { reason: 'ACCOUNT_INACTIVE', provider: 'MICROSOFT' },
    }, httpContext);
  }

  const accessToken = signAccessToken(authModel);
  const refreshToken = generateRandomToken(48);
  const refreshSession = buildRefreshSession(refreshToken, httpContext);

  await withAuthTransaction(async (session) => {
    await accountRepository.appendSession(authModel.account._id, refreshSession, { session });
    await accountRepository.updateLastLogin(authModel.account._id, httpContext.ipAddress, { session });
    await recordAuthEvent('microsoft-login', {
      actorType: 'ACCOUNT',
      actorAccountId: String(authModel.account._id),
      action: 'AUTH_LOGIN_SUCCEEDED',
      entityType: 'AUTH_ACCOUNT',
      entityId: String(authModel.account._id),
      outcome: 'SUCCEEDED',
      metadata: { provider: 'MICROSOFT', microsoftId },
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

async function changeOwnPassword(accountId, { currentPassword, newPassword }, httpContext = {}) {
  const account = await accountRepository.findByIdWithPassword(accountId);
  const passwordMatches = account && await verifyPassword(
    currentPassword,
    account.passwordHash,
    account.passwordSalt,
  );

  if (!passwordMatches) {
    throw authenticationError('Current password is incorrect');
  }

  const { passwordHash, passwordSalt } = await hashPassword(newPassword);
  return withAuthTransaction(async (session) => {
    const updated = await accountRepository.updatePassword(accountId, {
      passwordHash,
      passwordSalt,
      mustChangePassword: false,
    }, {
      session,
      expectedPassword: {
        passwordHash: account.passwordHash,
        passwordSalt: account.passwordSalt,
      },
    });

    if (!updated) {
      throw authenticationError('Current password is incorrect');
    }

    await recordAuthEvent('change-password', {
      actorType: 'ACCOUNT',
      actorAccountId: String(accountId),
      action: 'ACCOUNT_PASSWORD_CHANGED',
      entityType: 'AUTH_ACCOUNT',
      entityId: String(accountId),
      outcome: 'SUCCEEDED',
    }, httpContext, String(accountId), { session });

    return updated;
  });
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

async function listAccountIdsByScopes(scopes = []) {
  const accountRows = await accessAssignmentRepository.findAccountIdsByScopes(scopes || []);
  return [...new Set((accountRows || []).map((row) => String(row.accountId)).filter(Boolean))];
}

function normalizeList(values = []) {
  return (Array.isArray(values) ? values : [values]).filter(Boolean).map(String);
}

function teamScopesWithAny(authContext = {}, permissions = []) {
  const required = normalizeList(permissions);
  return (authContext.scopes || []).filter((scope) => (
    String(scope.scopeType || '').toLowerCase() === accessScopeTypes.TEAM
    && scope.scopeId
    && required.some((permission) => (scope.permissions || []).includes(permission))
  ));
}

async function listTeamScopedAccountIds(authContext = {}, permissions = []) {
  const teamIds = [...new Set(teamScopesWithAny(authContext, permissions).map((scope) => String(scope.scopeId)))];
  if (!teamIds.length) return [];
  const ids = new Set();
  await Promise.all(teamIds.map(async (teamId) => {
    const membership = await getOrganizationPublic().listTeamMembers(teamId);
    [...(membership?.leaders || []), ...(membership?.members || [])].forEach((member) => {
      const accountId = member?.accountId || member?.account;
      if (accountId) ids.add(String(accountId));
    });
  }));
  return [...ids];
}

function hasTeamQueueScope(authContext = {}, { roles = ['TEAM_LEADER'], permissions = [] } = {}) {
  const roleSet = new Set(normalizeList(roles));
  const permissionSet = new Set(normalizeList(permissions));
  return (authContext.scopes || []).some((scope) => (
    String(scope.scopeType || '').toLowerCase() === accessScopeTypes.TEAM
    && ((scope.roles || []).some((role) => roleSet.has(String(role)))
      || (scope.permissions || []).some((permission) => permissionSet.has(String(permission))))
  ));
}

async function listMigrationAccounts() {
  return accountRepository.listMigrationAccounts();
}

async function listChatDirectory(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const items = await accountRepository.listActiveDirectory({ search: query.search, limit });
  return {
    items: items.map((account) => ({
      id: String(account._id),
      email: account.email,
      status: account.status,
    })),
  };
}

async function listOperatingCostAccounts(accountIds = []) {
  return accountRepository.listOperatingCostAccounts(accountIds);
}

async function hasPermissionCodes(codes = []) {
  const permissions = await permissionRepository.listByCodes(codes);
  return permissions.length === [...new Set(codes)].length;
}

async function findAccountByMicrosoftId(microsoftId) {
  if (!microsoftId) return null;
  const authModel = await accountRepository.findAuthAccountByMicrosoftId(microsoftId);
  if (!authModel?.account) return null;
  return {
    id: String(authModel.account._id),
    email: authModel.account.email,
    microsoftId: authModel.account.microsoftId,
    status: authModel.account.status,
  };
}

async function findAccountByEmail(email) {
  if (!email) return null;
  const authModel = await accountRepository.findAuthAccountByEmail(normalizeEmail(email));
  if (!authModel?.account) return null;
  return {
    id: String(authModel.account._id),
    email: authModel.account.email,
    microsoftId: authModel.account.microsoftId,
    status: authModel.account.status,
  };
}

async function linkMicrosoftAccount(accountId, { microsoftId, avatarUrl } = {}) {
  const updated = await accountRepository.linkMicrosoftAccount(accountId, { microsoftId, avatarUrl });
  if (!updated) return null;
  return {
    id: String(updated._id),
    email: updated.email,
    microsoftId: updated.microsoftId,
    status: updated.status,
  };
}

async function ensureTeamsAccount({ entraUserId, email, displayName, isExternal = false } = {}) {
  if (!entraUserId && !email) return null;
  let authModel = null;
  if (entraUserId) {
    authModel = await accountRepository.findAuthAccountByMicrosoftId(entraUserId);
  }
  if (!authModel && email) {
    const normalized = normalizeEmail(email);
    authModel = await accountRepository.findAuthAccountByEmail(normalized);
    if (authModel && entraUserId) {
      await accountRepository.linkMicrosoftAccount(authModel.account._id, { microsoftId: entraUserId });
    }
  }
  if (authModel?.account) {
    return {
      id: String(authModel.account._id),
      email: authModel.account.email,
      microsoftId: authModel.account.microsoftId,
      status: authModel.account.status,
    };
  }

  const normalizedEmail = normalizeEmail(email || `teams_${entraUserId}@guest.lngwork.co`);
  const created = await accountRepository.create({
    email: normalizedEmail,
    microsoftId: entraUserId || undefined,
    authProvider: 'MICROSOFT',
    status: accountStatuses.ACTIVE,
    mustChangePassword: false,
  });

  return {
    id: String(created._id),
    email: created.email,
    microsoftId: created.microsoftId,
    status: created.status,
  };
}

module.exports = {
  normalizeEmail,
  register,
  login,
  loginWithGoogle,
  setGoogleOAuthClient,
  loginWithMicrosoft,
  setMicrosoftJwksClient,
  setMicrosoftTokenVerifier,
  refreshSession,
  logout,
  getCurrentAccount,
  changeOwnPassword,
  verifyAccessToken,
  buildAuthContext,
  invalidatePermissionCache,
  filterAssignableAccountIds,
  listChatDirectory,
  listOperatingCostAccounts,
  listMigrationAccounts,
  listAccountIdsByScopes,
  listTeamScopedAccountIds,
  hasTeamQueueScope,
  hasPermissionCodes,
  findAccountByMicrosoftId,
  findAccountByEmail,
  linkMicrosoftAccount,
  ensureTeamsAccount,
};
