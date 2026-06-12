const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');

function normalizeValues(values) {
  return values.map((value) => String(value).toUpperCase());
}

function authorizePermissions(...requiredPermissions) {
  const normalizedPermissions = normalizeValues(requiredPermissions);

  return function authorizePermissionsMiddleware(req, res, next) {
    const grantedPermissions = req.auth ? req.auth.permissions : [];
    const hasAllPermissions = normalizedPermissions.every((permission) => grantedPermissions.includes(permission));

    if (!hasAllPermissions) {
      next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
      return;
    }

    next();
  };
}

function authorizeAnyPermission(...candidatePermissions) {
  const normalizedPermissions = normalizeValues(candidatePermissions);

  return function authorizeAnyPermissionMiddleware(req, res, next) {
    const grantedPermissions = req.auth ? req.auth.permissions : [];
    const hasAnyPermission = normalizedPermissions.some((permission) => grantedPermissions.includes(permission));

    if (!hasAnyPermission) {
      next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
      return;
    }

    next();
  };
}

function authorizeRoles(...requiredRoles) {
  const normalizedRoles = normalizeValues(requiredRoles);

  return function authorizeRolesMiddleware(req, res, next) {
    const grantedRoles = req.auth ? req.auth.roles : [];
    const hasRole = normalizedRoles.some((role) => grantedRoles.includes(role));

    if (!hasRole) {
      next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
      return;
    }

    next();
  };
}

module.exports = {
  authorizePermissions,
  authorizeAnyPermission,
  authorizeRoles,
};
