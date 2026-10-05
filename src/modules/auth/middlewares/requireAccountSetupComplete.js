const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');

const allowedSetupActions = new Set([
  'GET /api/auth/me',
  'POST /api/auth/me/change-password',
  'GET /api/hr/employee-profiles/me',
  'PATCH /api/hr/employee-profiles/me/personal',
  'POST /api/hr/employee-profiles/me/avatar',
  'POST /api/auth/logout',
]);

function requestAction(req) {
  return `${req.method} ${req.baseUrl || ''}${req.path || ''}`;
}

function requireAccountSetupComplete(req, _res, next) {
  if (
    req.auth?.mustChangePassword
    && !allowedSetupActions.has(requestAction(req))
  ) {
    return next(new AppError(
      'Account setup required',
      httpStatus.FORBIDDEN,
      true,
      errorCodes.ACCOUNT_SETUP_REQUIRED,
    ));
  }
  return next();
}

module.exports = requireAccountSetupComplete;
