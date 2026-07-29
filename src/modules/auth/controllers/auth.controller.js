const AppError = require('../../../shared/errors/appError');
const config = require('../../../config');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const authManager = require('../services/authManager.service');
const { toAccountDto, toNonGlobalScopedAccessDto } = require('../dtos/auth.dto');
const {
  loginSchema,
  registerSchema,
  refreshSchema,
  logoutSchema,
  changeOwnPasswordSchema,
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

async function login(req, res) {
  const payload = assertValid(loginSchema, req.body);
  const session = await authManager.login(
    payload.identifier || payload.email,
    payload.password,
    requestContext(req),
  );

  res.status(httpStatus.OK).json({
    success: true,
    data: session,
  });
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
  const payload = assertValid(refreshSchema, req.body);
  const session = await authManager.refreshSession(payload.refreshToken, requestContext(req));

  res.status(httpStatus.OK).json({
    success: true,
    data: session,
  });
}

async function logout(req, res) {
  const payload = assertValid(logoutSchema, req.body);
  await authManager.logout(payload.refreshToken, requestContext(req));

  res.status(httpStatus.NO_CONTENT).send();
}

async function me(req, res) {
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

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  changeOwnPassword,
};
