const AppError = require('../../../shared/errors/appError');
const config = require('../../../config');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const authManager = require('../services/authManager.service');
const { toAccountDto, toProfileDto, toScopedAccessDto } = require('../dtos/auth.dto');
const {
  loginSchema,
  registerSchema,
  refreshSchema,
  logoutSchema,
  validate,
} = require('../validators/auth.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);

  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }

  return value;
}

async function login(req, res) {
  const payload = assertValid(loginSchema, req.body);
  const session = await authManager.login(payload.email, payload.password, req.ip, req.get('user-agent'));

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
  const result = await authManager.register(payload.email, payload.password, payload.fullName);

  res.status(httpStatus.CREATED).json({
    success: true,
    data: result,
  });
}

async function refresh(req, res) {
  const payload = assertValid(refreshSchema, req.body);
  const session = await authManager.refreshSession(payload.refreshToken, req.ip, req.get('user-agent'));

  res.status(httpStatus.OK).json({
    success: true,
    data: session,
  });
}

async function logout(req, res) {
  const payload = assertValid(logoutSchema, req.body);
  await authManager.logout(payload.refreshToken);

  res.status(httpStatus.NO_CONTENT).send();
}

async function me(req, res) {
  const authModel = await authManager.getCurrentAccount(req.auth.accountId);

  res.status(httpStatus.OK).json({
    success: true,
    data: {
      account: toAccountDto(authModel.account),
      profile: toProfileDto(authModel.profile),
      roles: authModel.roles,
      permissions: authModel.permissions,
      scopes: toScopedAccessDto(authModel.scopes),
    },
  });
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
};
