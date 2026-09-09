const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const authManager = require('../services/authManager.service');
const extensionTokenService = require('../services/extensionToken.service');
const requireAccountSetupComplete = require('./requireAccountSetupComplete');

function extractBearerToken(req) {
  const authorization = req.get('authorization');

  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length).trim();
}

function isJwtValidationError(error) {
  return ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name);
}

async function measureAuthStage(timings, stage, operation) {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    timings[stage] = Date.now() - startedAt;
  }
}

async function authenticate(req, res, next) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
    }

    const extensionAuth = await extensionTokenService.authenticate(token);
    if (extensionAuth) {
      req.auth = extensionAuth;
      next();
      return;
    }

    const payload = authManager.verifyAccessToken(token);
    const authTimings = {};
    const authModel = await measureAuthStage(authTimings, 'authAccount', () => (
      authManager.getCurrentAccount(payload.sub, payload.tokenVersion ?? 0)
    ));

    req.auth = authManager.buildAuthContext(authModel);
    const profile = await measureAuthStage(authTimings, 'employeeProfile', () => (
      require('../../hr/public').getEmployeeProfileByAccountId(req.auth.accountId)
    ));
    req.auth.profileSetupRequired = !profile || !profile.isProfileUpdated;
    req.authTimings = authTimings;
    requireAccountSetupComplete(req, res, next);
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }

    if (isJwtValidationError(error)) {
      next(new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR));
      return;
    }

    next(error);
  }
}

module.exports = authenticate;
