const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');

function normalizeValues(values) {
  return values.map((value) => String(value).toUpperCase());
}

function normalizePermission(permission) {
  return String(permission).toUpperCase();
}

function normalizeScope(scope = {}) {
  return {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId === undefined || scope.scopeId === null ? null : String(scope.scopeId),
  };
}

function scopeMatches(grantedScope, requiredScope) {
  if (!grantedScope || grantedScope.scopeType !== requiredScope.scopeType) {
    return false;
  }

  if (requiredScope.scopeType === 'own') {
    return grantedScope.scopeId === null || grantedScope.scopeId === requiredScope.scopeId;
  }

  return (grantedScope.scopeId || null) === requiredScope.scopeId;
}

function canAccessScope(authContext, permission, scope) {
  if (!authContext) {
    return false;
  }

  const requiredPermission = normalizePermission(permission);
  const globalPermissions = authContext.permissions || [];

  if (globalPermissions.includes(requiredPermission)) {
    return true;
  }

  const requiredScope = normalizeScope(scope);
  const scopes = authContext.scopes || [];

  return scopes.some((grantedScope) => {
    const grantedPermissions = grantedScope.permissions || [];
    return scopeMatches(grantedScope, requiredScope) && grantedPermissions.includes(requiredPermission);
  });
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

function authorizeScopedPermission(permission, scopeResolver) {
  return function authorizeScopedPermissionMiddleware(req, res, next) {
    const scope = typeof scopeResolver === 'function' ? scopeResolver(req) : scopeResolver;

    if (!scope || !scope.scopeType) {
      next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
      return;
    }

    if (!canAccessScope(req.auth, permission, scope)) {
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
  authorizeScopedPermission,
  canAccessScope,
  authorizeAnyPermission,
  authorizeRoles,
};
