const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const { roleCodes } = require('../constants/auth.constants');

function normalizeValues(values) {
  return values.map((value) => String(value).toUpperCase());
}

function normalizePermission(permission) {
  return String(permission).toUpperCase();
}

function getGrantedPermissions(authContext) {
  if (!authContext) {
    return [];
  }

  const globalPermissions = authContext.permissions || [];
  const scopedPermissions = (authContext.scopes || []).flatMap((scope) => scope.permissions || []);

  return [...new Set([...globalPermissions, ...scopedPermissions])];
}

function getGrantedRoles(authContext) {
  if (!authContext) {
    return [];
  }

  const globalRoles = authContext.roles || [];
  const scopedRoles = (authContext.scopes || []).flatMap((scope) => scope.roles || []);

  return [...new Set([...globalRoles, ...scopedRoles])];
}

function isSuperAdmin(authContext) {
  return (authContext?.roles || []).some((role) => normalizePermission(role) === roleCodes.SUPER_ADMIN);
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
    return grantedScope.scopeId === null || String(grantedScope.scopeId) === String(requiredScope.scopeId);
  }

  if (grantedScope.scopeId === undefined || grantedScope.scopeId === null) {
    return requiredScope.scopeId === null;
  }

  return String(grantedScope.scopeId) === String(requiredScope.scopeId);
}

function canAccessScope(authContext, permission, scope) {
  if (!authContext) {
    return false;
  }

  if (isSuperAdmin(authContext)) {
    return true;
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

  const middleware = function authorizePermissionsMiddleware(req, res, next) {
    const grantedPermissions = req.auth ? req.auth.permissions || [] : [];
    const hasAllPermissions = isSuperAdmin(req.auth)
      || normalizedPermissions.every((permission) => grantedPermissions.includes(permission));

    if (!hasAllPermissions) {
      next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
      return;
    }

    next();
  };
  middleware.authorization = { mode: 'ALL', permissions: normalizedPermissions };
  return middleware;
}

function authorizeScopedPermission(permission, scopeResolver) {
  const middleware = function authorizeScopedPermissionMiddleware(req, res, next) {
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
  middleware.authorization = { mode: 'SCOPED', permissions: normalizeValues([permission]) };
  return middleware;
}

function authorizeAnyPermission(...candidatePermissions) {
  const normalizedPermissions = normalizeValues(candidatePermissions);

  const middleware = function authorizeAnyPermissionMiddleware(req, res, next) {
    const grantedPermissions = getGrantedPermissions(req.auth);
    const hasAnyPermission = isSuperAdmin(req.auth)
      || normalizedPermissions.some((permission) => grantedPermissions.includes(permission));

    if (!hasAnyPermission) {
      next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
      return;
    }

    next();
  };
  middleware.authorization = { mode: 'ANY', permissions: normalizedPermissions };
  return middleware;
}

function authorizeRoles(...requiredRoles) {
  const normalizedRoles = normalizeValues(requiredRoles);

  const middleware = function authorizeRolesMiddleware(req, res, next) {
    const grantedRoles = getGrantedRoles(req.auth);
    const hasRole = isSuperAdmin(req.auth)
      || normalizedRoles.some((role) => grantedRoles.includes(role));

    if (!hasRole) {
      next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
      return;
    }

    next();
  };
  middleware.authorization = { mode: 'ROLE', roles: normalizedRoles };
  return middleware;
}

module.exports = {
  authorizePermissions,
  authorizeScopedPermission,
  canAccessScope,
  isSuperAdmin,
  authorizeAnyPermission,
  authorizeRoles,
};
