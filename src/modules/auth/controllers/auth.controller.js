const AppError = require('../../../shared/errors/appError');
const config = require('../../../config');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const authManager = require('../services/authManager.service');
const { toAccountDto, toNonGlobalScopedAccessDto } = require('../dtos/auth.dto');
const {
  loginSchema,
  googleLoginSchema,
  microsoftLoginSchema,
  registerSchema,
  refreshSchema,
  logoutSchema,
  changeOwnPasswordSchema,
  initialPasswordSchema,
  validate,
} = require('../validators/auth.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);

  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }

  return value;
}

function boundedAuditText(value, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, maxLength) : null;
}

function requestContext(req) {
  return {
    requestId: req.id,
    ipAddress: boundedAuditText(req.ip, 100),
    userAgent: boundedAuditText(req.get('user-agent'), 500),
  };
}

function refreshTokenFromRequest(req) {
  if (req.body?.refreshToken) return req.body.refreshToken;
  const cookie = req.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)refreshToken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function setRefreshTokenCookie(res, refreshToken) {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: config.auth.refreshTokenExpiresDays * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

function respondWithSession(res, session) {
  const { refreshToken, tokenType = 'Bearer', ...data } = session;
  setRefreshTokenCookie(res, refreshToken);
  res.status(httpStatus.OK).json({ success: true, data: { ...data, tokenType } });
}

async function login(req, res) {
  const payload = assertValid(loginSchema, req.body);
  const session = await authManager.login(
    payload.identifier || payload.email,
    payload.password,
    requestContext(req),
  );

  respondWithSession(res, session);
}

async function googleLogin(req, res) {
  const payload = assertValid(googleLoginSchema, req.body);
  const session = await authManager.loginWithGoogle(
    payload,
    requestContext(req),
  );

  respondWithSession(res, session);
}

async function microsoftLogin(req, res) {
  const payload = assertValid(microsoftLoginSchema, req.body);
  const session = await authManager.loginWithMicrosoft(
    payload.idToken,
    requestContext(req),
  );

  respondWithSession(res, session);
}

async function register(req, res) {
  if (!config.auth.registerEnabled) {
    throw new AppError('Registration is disabled', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }

  const payload = assertValid(registerSchema, req.body);
  const result = await authManager.register(
    payload.email,
    payload.password,
    undefined,
    requestContext(req),
  );

  res.status(httpStatus.CREATED).json({
    success: true,
    data: result,
  });
}

async function refresh(req, res) {
  const refreshToken = refreshTokenFromRequest(req);
  if (!refreshToken) {
    throw new AppError('Refresh session not found', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }
  const payload = assertValid(refreshSchema, { refreshToken });
  const session = await authManager.refreshSession(payload.refreshToken, requestContext(req));
  respondWithSession(res, session);
}

async function logout(req, res) {
  const refreshToken = refreshTokenFromRequest(req);
  const payload = assertValid(logoutSchema, { refreshToken });
  await authManager.logout(payload.refreshToken, requestContext(req));

  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.status(httpStatus.NO_CONTENT).send();
}

async function me(req, res) {
  if (req.auth.tokenType === 'EXTENSION') {
    const data = await require('../services/extensionToken.service').getIdentity(req.auth);
    res.status(httpStatus.OK).json({ success: true, data });
    return;
  }
  const authModel = await authManager.getCurrentAccount(req.auth.accountId);

  res.status(httpStatus.OK).json({
    success: true,
    data: {
      account: toAccountDto(authModel.account),
      roles: authModel.roles,
      permissions: authModel.permissions,
      scopes: toNonGlobalScopedAccessDto(authModel.scopes),
      profileSetupRequired: Boolean(req.auth.profileSetupRequired),
    },
  });
}

async function changeOwnPassword(req, res) {
  const payload = assertValid(changeOwnPasswordSchema, req.body);
  const account = await authManager.changeOwnPassword(req.auth.accountId, payload, requestContext(req));

  res.status(httpStatus.OK).json({
    success: true,
    data: toAccountDto(account),
  });
}

async function setInitialPassword(req, res) {
  const payload = assertValid(initialPasswordSchema, req.body);
  const account = await authManager.setInitialPassword(req.auth.accountId, payload, requestContext(req));
  res.status(httpStatus.OK).json({ success: true, data: toAccountDto(account) });
}

module.exports = {
  register,
  login,
  googleLogin,
  microsoftLogin,
  refresh,
  logout,
  me,
  changeOwnPassword,
  setInitialPassword,
};
