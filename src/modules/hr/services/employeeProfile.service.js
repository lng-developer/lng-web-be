const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const organizationPublic = require('../../organization/public');
const { hrPermissions, hrTimePermissions } = require('../constants/hr.constants');
const { toEmployeeProfileDetailDto, toPaginatedEmployeeProfileDto } = require('../dtos/employeeProfile.dto');
const repository = require('../repositories/employeeProfile.repository');

const sensitiveKeys = [
  'identityCard',
  'taxIdentification',
  'socialInsuranceNumber',
  'bankAccount',
  'baseCurrency',
  'baseSalary',
  'allowances',
  'responsibilityAllowance',
];

function hasPermission(authContext, permission) {
  return (authContext?.permissions || []).includes(permission);
}

function canReadSensitive(authContext) {
  return hasPermission(authContext, hrPermissions.COMPENSATION_READ)
    || hasPermission(authContext, hrPermissions.COMPENSATION_WRITE);
}

function hasGlobalEmployeePermission(authContext, permissions) {
  return permissions.some((permission) => hasPermission(authContext, permission));
}

function canAccessProfile(authContext, profile, permissions) {
  if (hasGlobalEmployeePermission(authContext, permissions)) return true;
  return permissions.some((permission) => authPublic.canAccessScope(authContext, permission, {
    scopeType: 'team', scopeId: profile.teamId || null,
  }) || authPublic.canAccessScope(authContext, permission, {
    scopeType: 'department', scopeId: profile.departmentId || null,
  }));
}

function profileScopeFilters(authContext, permissions) {
  return (authContext.scopes || []).flatMap((scope) => {
    if (!permissions.some((permission) => (scope.permissions || []).includes(permission))) return [];
    if (scope.scopeType === 'team' && scope.scopeId) return [{ teamId: String(scope.scopeId) }];
    if (scope.scopeType === 'department' && scope.scopeId) return [{ departmentId: String(scope.scopeId) }];
    return [];
  });
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function assertCanAccessProfile(authContext, profile, permissions) {
  if (!canAccessProfile(authContext, profile, permissions)) throw forbidden();
}

function assertObjectId(value, field) {
  if (value !== null && value !== undefined && !mongoose.isValidObjectId(value)) {
    throw new AppError(`${field} is invalid`, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

function assertCanWriteSensitive(authContext, payload) {
  const hasSensitivePayload = sensitiveKeys.some((key) => Object.hasOwn(payload || {}, key));
  if (hasSensitivePayload && !hasPermission(authContext, hrPermissions.COMPENSATION_WRITE)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
}

function normalizeProfilePayload(payload = {}) {
  return {
    ...payload,
    ...(payload.employeeCode ? { employeeCode: String(payload.employeeCode).trim().toUpperCase() } : {}),
  };
}

async function assertActiveAccount(accountId) {
  assertObjectId(accountId, 'accountId');
  try {
    return await authPublic.getCurrentAccount(accountId);
  } catch (error) {
    if (error?.code === errorCodes.AUTHENTICATION_ERROR) {
      throw new AppError('Account is unavailable', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
    throw error;
  }
}

async function resolveOrganization({ departmentId, teamId }) {
  assertObjectId(departmentId, 'departmentId');
  assertObjectId(teamId, 'teamId');

  let department = null;
  if (departmentId) {
    department = await organizationPublic.getDepartmentById(departmentId);
    if (!department || department.status !== 'ACTIVE') {
      throw new AppError('Department not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
  }

  if (!teamId) return { departmentId: departmentId || null, teamId: null };

  const team = await organizationPublic.getTeamById(teamId);
  if (!team || team.status !== 'ACTIVE') {
    throw new AppError('Team not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }

  const teamDepartmentId = String(team.departmentId?._id || team.departmentId || '');
  if (department && teamDepartmentId !== String(department._id || department.id)) {
    throw new AppError('Team does not belong to department', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  return { departmentId: departmentId || teamDepartmentId, teamId };
}

function duplicateError(error, message) {
  if (error?.code === 11000) {
    return new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }
  return error;
}

function organizationOptions(profile, organizationsByAccountId) {
  const organization = organizationsByAccountId.get(String(profile.accountId));
  return { department: organization?.department || null, team: organization?.team || null };
}

async function organizationOptionsForProfiles(profiles) {
  const accountIds = [...new Set(profiles.map((profile) => profile.accountId).filter(Boolean).map(String))];
  if (!accountIds.length) return new Map();
  const organizations = await organizationPublic.listAccountOrganizationSummaries?.(accountIds) || [];
  return new Map(organizations.map((organization) => [String(organization.accountId), organization]));
}

async function createProfile(payload, authContext = {}) {
  const normalizedPayload = normalizeProfilePayload(payload);
  assertCanWriteSensitive(authContext, normalizedPayload);
  const organization = await resolveOrganization(normalizedPayload);
  assertCanAccessProfile(
    authContext,
    { ...normalizedPayload, ...organization },
    [hrPermissions.EMPLOYEE_WRITE],
  );
  await assertActiveAccount(normalizedPayload.accountId);

  const [existingAccount, existingCode] = await Promise.all([
    repository.findByAccountId(normalizedPayload.accountId, { includeDeleted: true }),
    repository.findByEmployeeCode(normalizedPayload.employeeCode, { includeDeleted: true }),
  ]);
  if (existingAccount) {
    throw new AppError('Account already has an HR profile', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }
  if (existingCode) {
    throw new AppError('Employee code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }

  try {
    const profile = await repository.create({ ...normalizedPayload, ...organization });
    return toEmployeeProfileDetailDto(profile, { includeSensitive: canReadSensitive(authContext) });
  } catch (error) {
    throw duplicateError(error, 'Employee profile has duplicate fields');
  }
}

async function listProfiles(query = {}, authContext = {}) {
  if (query.includeDeleted && !hasPermission(authContext, hrPermissions.EMPLOYEE_WRITE)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
  if (query.includeSensitive && !canReadSensitive(authContext)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
  const permissions = [
    hrPermissions.EMPLOYEE_READ,
    hrPermissions.EMPLOYEE_WRITE,
    hrPermissions.CALENDAR_READ,
    hrPermissions.CALENDAR_WRITE,
    hrTimePermissions.SCHEDULE_READ,
    hrTimePermissions.SCHEDULE_WRITE,
    hrTimePermissions.ATTENDANCE_READ,
    hrTimePermissions.ATTENDANCE_MANAGE,
  ];
  const scopeFilters = hasGlobalEmployeePermission(authContext, permissions)
    ? []
    : profileScopeFilters(authContext, permissions);
  if (!hasGlobalEmployeePermission(authContext, permissions) && !scopeFilters.length) throw forbidden();
  const result = await repository.list({ ...query, scopeFilters });
  const organizationsByAccountId = await organizationOptionsForProfiles(result.items || []);
  return toPaginatedEmployeeProfileDto(result, (profile) => ({
    ...organizationOptions(profile, organizationsByAccountId),
    capabilities: { edit: canAccessProfile(authContext, profile, [hrPermissions.EMPLOYEE_WRITE]) },
  }));
}

async function getProfile(profileId, authContext = {}, { includeSensitive = false } = {}) {
  assertObjectId(profileId, 'profileId');
  if (includeSensitive && !canReadSensitive(authContext)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
  const profile = await repository.findById(profileId, { includeSensitive });
  if (!profile || profile.isDeleted) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  if (!canAccessProfile(authContext, profile, [hrPermissions.EMPLOYEE_READ, hrPermissions.EMPLOYEE_WRITE])) throw forbidden();
  const organizationsByAccountId = await organizationOptionsForProfiles([profile]);
  return toEmployeeProfileDetailDto(profile, {
    includeSensitive,
    capabilities: { edit: canAccessProfile(authContext, profile, [hrPermissions.EMPLOYEE_WRITE]) },
    ...organizationOptions(profile, organizationsByAccountId),
  });
}

async function getMyProfile(authContext = {}) {
  if (!authContext.accountId) {
    throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }
  const profile = await repository.findByAccountId(authContext.accountId, { includeSensitive: canReadSensitive(authContext) });
  if (!profile) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return toEmployeeProfileDetailDto(profile, {
    includeSensitive: canReadSensitive(authContext),
    capabilities: { edit: canAccessProfile(authContext, profile, [hrPermissions.EMPLOYEE_WRITE]) },
  });
}

async function updateProfile(profileId, payload, authContext = {}) {
  assertObjectId(profileId, 'profileId');
  const normalizedPayload = normalizeProfilePayload(payload);
  assertCanWriteSensitive(authContext, normalizedPayload);
  const current = await repository.findById(profileId, { includeSensitive: true });
  if (!current || current.isDeleted) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  assertCanAccessProfile(authContext, current, [hrPermissions.EMPLOYEE_WRITE]);

  const organization = await resolveOrganization({
    departmentId: Object.hasOwn(normalizedPayload, 'departmentId') ? normalizedPayload.departmentId : current.departmentId,
    teamId: Object.hasOwn(normalizedPayload, 'teamId') ? normalizedPayload.teamId : current.teamId,
  });
  assertCanAccessProfile(
    authContext,
    { ...current, ...normalizedPayload, ...organization },
    [hrPermissions.EMPLOYEE_WRITE],
  );

  if (normalizedPayload.accountId && String(normalizedPayload.accountId) !== String(current.accountId)) {
    await assertActiveAccount(normalizedPayload.accountId);
    const existing = await repository.findByAccountId(normalizedPayload.accountId, { includeDeleted: true });
    if (existing && String(existing._id || existing.id) !== String(profileId)) {
      throw new AppError('Account already has an HR profile', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
  }
  if (normalizedPayload.employeeCode && normalizedPayload.employeeCode !== current.employeeCode) {
    const existing = await repository.findByEmployeeCode(normalizedPayload.employeeCode, { includeDeleted: true });
    if (existing && String(existing._id || existing.id) !== String(profileId)) {
      throw new AppError('Employee code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
  }

  try {
    const updated = await repository.updateById(profileId, { ...normalizedPayload, ...organization });
    return toEmployeeProfileDetailDto(updated, { includeSensitive: canReadSensitive(authContext) });
  } catch (error) {
    throw duplicateError(error, 'Employee profile has duplicate fields');
  }
}

async function deleteProfile(profileId, authContext = {}) {
  assertObjectId(profileId, 'profileId');
  const current = await repository.findById(profileId);
  if (!current) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  assertCanAccessProfile(authContext, current, [hrPermissions.EMPLOYEE_WRITE]);
  const profile = await repository.softDelete(profileId);
  if (!profile) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return toEmployeeProfileDetailDto(profile);
}

async function restoreProfile(profileId, authContext = {}) {
  assertObjectId(profileId, 'profileId');
  const current = await repository.findById(profileId);
  if (!current) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  assertCanAccessProfile(authContext, current, [hrPermissions.EMPLOYEE_WRITE]);
  const profile = await repository.restore(profileId);
  if (!profile) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return toEmployeeProfileDetailDto(profile);
}

module.exports = {
  createProfile,
  deleteProfile,
  getMyProfile,
  getProfile,
  listProfiles,
  restoreProfile,
  updateProfile,
};
