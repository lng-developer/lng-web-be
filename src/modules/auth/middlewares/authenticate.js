const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const authManager = require('../services/authManager.service');
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

async function authenticate(req, res, next) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
    }

    const payload = authManager.verifyAccessToken(token);
    const authModel = await authManager.getCurrentAccount(payload.sub, payload.tokenVersion ?? 0);

    req.auth = authManager.buildAuthContext(authModel);
    const profile = await require('../../hr/public').getEmployeeProfileByAccountId(req.auth.accountId);
    req.auth.profileSetupRequired = Boolean(profile && !profile.isProfileUpdated);
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
