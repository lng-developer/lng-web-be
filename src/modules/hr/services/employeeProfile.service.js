const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');
const { Readable } = require('stream');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const auditPublic = require('../../audit/public');
const organizationPublic = require('../../organization/public');
const mediaPublic = require('../../media/public');
const { organizationStatuses } = require('../../organization/constants');
const logger = require('../../../shared/utils/logger');
const { hrPermissions, hrTimePermissions } = require('../constants/hr.constants');
const {
  toEmployeePersonalProfileDto,
  toEmployeeProfileDetailDto,
  toPaginatedEmployeeProfileDto,
} = require('../dtos/employeeProfile.dto');
const repository = require('../repositories/employeeProfile.repository');

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const selfProfileDuplicateRetryDelaysMs = [0, 25, 75];
const avatarTypes = new Map([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/webp', new Set(['.webp'])],
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
const piiKeys = new Set([
  ...sensitiveKeys,
  'address',
  'birthDate',
  'contractNumber',
  'dependantDetails',
  'emergencyContact',
  'personalEmail',
  'phoneNumber',
  'workEmail',
]);
const personalProfileKeys = new Set([
  'gender',
  'birthDate',
  'phoneNumber',
  'address',
  'personalEmail',
  'emergencyContact',
  'dependantDetails',
  'identityCard',
  'taxIdentification',
  'socialInsuranceNumber',
  'bankAccount',
]);
const duplicateFieldLabels = {
  accountId: 'Account',
  employeeCode: 'Employee code',
  identityCard: 'Identity card',
  personalEmail: 'Personal email',
  socialInsuranceNumber: 'Social insurance number',
  taxIdentification: 'Tax identification',
  workEmail: 'Work email',
};

function auditScope(profile = {}) {
  if (profile.teamId) return { scopeType: 'TEAM', scopeId: String(profile.teamId) };
  if (profile.departmentId) return { scopeType: 'DEPARTMENT', scopeId: String(profile.departmentId) };
  return { scopeType: null, scopeId: null };
}

async function recordProfileAudit(action, profile, authContext = {}, metadata = {}, { required = false, session } = {}) {
  const entityId = String(profile._id || profile.id);
  try {
    await auditPublic.record({
      actorType: authContext.accountId ? 'ACCOUNT' : 'SYSTEM',
      actorAccountId: authContext.accountId || null,
      actorSnapshot: {},
      action,
      entityType: 'HR_EMPLOYEE_PROFILE',
      entityId,
      ...auditScope(profile),
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      changes: null,
      metadata,
      deduplicationKey: `hr:${action.toLowerCase()}:${entityId}:${crypto.randomUUID()}`,
    }, { session });
  } catch (error) {
    if (required) throw error;
    logger.warn('hr_profile_audit_write_failed', { action, entityId, error });
  }
}

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

function profileCapabilities(profile, authContext) {
  const canWrite = canAccessProfile(authContext, profile, [hrPermissions.EMPLOYEE_WRITE]);
  const isDeleted = Boolean(profile.isDeleted);
  return {
    edit: canWrite && !isDeleted,
    delete: canWrite && !isDeleted,
    restore: canWrite && isDeleted,
  };
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

function assertAvatarFile(file = {}) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const allowedExtensions = avatarTypes.get(String(file.mimetype || '').toLowerCase());
  const mimeType = String(file.mimetype || '').toLowerCase();
  const hasValidSignature = mimeType === 'image/jpeg'
    ? file.buffer?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : mimeType === 'image/png'
      ? file.buffer?.subarray(0, 8).equals(PNG_SIGNATURE)
      : mimeType === 'image/webp'
        ? file.buffer?.subarray(0, 4).toString('ascii') === 'RIFF'
          && file.buffer?.subarray(8, 12).toString('ascii') === 'WEBP'
        : false;
  if (!Buffer.isBuffer(file.buffer)
    || file.buffer.length === 0
    || file.buffer.length > MAX_AVATAR_BYTES
    || !allowedExtensions?.has(extension)
    || !hasValidSignature) {
    throw new AppError(
      'Avatar must be a JPEG, PNG, or WebP image up to 5MB',
      httpStatus.BAD_REQUEST,
      true,
      errorCodes.VALIDATION_ERROR,
    );
  }
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

async function discardAvatarAsset(assetId, profileId, reason) {
  try {
    await mediaPublic.discardUnattachedAsset(
      assetId, { source: 'HR_AVATAR', profileId }, reason,
    );
  } catch (error) {
    logger.warn('hr_avatar_asset_cleanup_failed', { assetId, profileId, reason, error });
  }
}

function assertProfileDateOrder(profile) {
  const pairs = [
    ['startDate', 'probationEndDate'],
    ['startDate', 'endDate'],
    ['contractStartDate', 'contractEndDate'],
  ];
  if (pairs.some(([start, end]) => profile[start] && profile[end]
    && new Date(profile[end]) < new Date(profile[start]))) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
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
    if (!department || String(department.status).toLowerCase() !== organizationStatuses.ACTIVE) {
      throw new AppError('Department not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
  }

  if (!teamId) return { departmentId: departmentId || null, teamId: null };

  const team = await organizationPublic.getTeamById(teamId);
  if (!team || String(team.status).toLowerCase() !== organizationStatuses.ACTIVE) {
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
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0];
    const label = duplicateFieldLabels[field];
    return new AppError(
      label ? `${label} is already in use` : message,
      httpStatus.CONFLICT,
      true,
      errorCodes.CONFLICT_ERROR,
      field ? { field } : undefined,
    );
  }
  return error;
}

async function findConcurrentSelfProfile(accountId) {
  for (const delayMs of selfProfileDuplicateRetryDelaysMs) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const profile = await repository.findByAccountId(accountId, { includeSensitive: true });
    if (profile) return profile;
  }
  return null;
}

function organizationOptions(profile, organizationsByAccountId) {
  const organization = organizationsByAccountId.get(String(profile.accountId));
  return { department: organization?.department || null, team: organization?.team || null };
}

async function organizationOptionsForProfiles(profiles) {
  const accountIds = [...new Set(profiles.map((profile) => profile.accountId).filter(Boolean).map(String))];
  if (!accountIds.length) return new Map();
  const departmentIds = [...new Set(profiles.map((profile) => profile.departmentId).filter(Boolean).map(String))];
  const teamIds = [...new Set(profiles.map((profile) => profile.teamId).filter(Boolean).map(String))];
  const [organizations, departments, teams] = await Promise.all([
    organizationPublic.listAccountOrganizationSummaries?.(accountIds) || [],
    organizationPublic.listDepartmentsByIds(departmentIds),
    organizationPublic.listTeamsByIds(teamIds),
  ]);
  const organizationsByAccountId = new Map(
    organizations.map((organization) => [String(organization.accountId), organization]),
  );
  const departmentsById = new Map(departments.map((department) => [String(department.id), department]));
  const teamsById = new Map(teams.map((team) => [String(team.id), team]));

  return new Map(profiles.map((profile) => {
    const organization = organizationsByAccountId.get(String(profile.accountId)) || {};
    return [String(profile.accountId), {
      ...organization,
      department: organization.department || departmentsById.get(String(profile.departmentId)) || null,
      team: organization.team || teamsById.get(String(profile.teamId)) || null,
    }];
  }));
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
    await recordProfileAudit('HR_EMPLOYEE_PROFILE_CREATED', profile, authContext, {
      status: profile.status || null,
    });
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
    capabilities: profileCapabilities(profile, authContext),
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
    capabilities: profileCapabilities(profile, authContext),
    ...organizationOptions(profile, organizationsByAccountId),
  });
}

async function getMyProfile(authContext = {}) {
  if (!authContext.accountId) {
    throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }
  const profile = await ensureMyProfile(authContext);
  const organizationsByAccountId = await organizationOptionsForProfiles([profile]);
  return toEmployeePersonalProfileDto(profile, {
    ...organizationOptions(profile, organizationsByAccountId),
  });
}

async function ensureMyProfile(authContext = {}) {
  const existing = await repository.findByAccountId(authContext.accountId, {
    includeDeleted: true,
    includeSensitive: true,
  });
  if (existing && !existing.isDeleted) return existing;

  const accountId = String(authContext.accountId);
  const email = String(authContext.email || '').trim().toLowerCase();
  const fallbackName = email.split('@')[0] || `Account ${accountId.slice(-6)}`;
  const draft = {
    accountId,
    employeeCode: `ACC${accountId.slice(-6)}`.toUpperCase(),
    fullName: fallbackName,
    workEmail: email || undefined,
    isDeleted: false,
    deletedAt: null,
    isProfileUpdated: false,
  };
  if (existing?.isDeleted) return repository.updateById(existing._id || existing.id, draft);
  try {
    return await repository.create(draft);
  } catch (error) {
    if (error.code !== 11000) throw error;
    const concurrentProfile = await findConcurrentSelfProfile(authContext.accountId);
    if (concurrentProfile) return concurrentProfile;
    throw duplicateError(error, 'Unable to create employee profile');
  }
}

async function updateMyPersonalProfile(payload = {}, authContext = {}) {
  if (!authContext.accountId) {
    throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }
  const forbiddenFields = Object.keys(payload).filter((key) => !personalProfileKeys.has(key));
  if (forbiddenFields.length) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  const current = await ensureMyProfile(authContext);
  try {
    const updated = await repository.updateById(current._id || current.id, {
      ...payload,
      isProfileUpdated: true,
    });
    const changedFields = Object.keys(payload).sort();
    await recordProfileAudit('HR_EMPLOYEE_PROFILE_PERSONAL_COMPLETED', updated, authContext, { changedFields });
    return toEmployeePersonalProfileDto({ ...updated, ...payload });
  } catch (error) {
    throw duplicateError(error, 'Employee profile has duplicate fields');
  }
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
  assertProfileDateOrder({ ...current, ...normalizedPayload });

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
    const update = { ...normalizedPayload, ...organization };
    const teamChanged = Object.hasOwn(normalizedPayload, 'teamId')
      && String(current.teamId || '') !== String(organization.teamId || '');
    let updated;
    if (teamChanged) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          updated = await repository.updateById(profileId, update, { session });
          if (organization.teamId) {
            await organizationPublic.syncTeamMembership({
              accountId: current.accountId,
              teamId: organization.teamId,
            }, { session });
          } else {
            await organizationPublic.deactivateTeamMembership(current.accountId, { session });
          }
        });
      } finally {
        await session.endSession();
      }
    } else {
      updated = await repository.updateById(profileId, update);
    }
    const changedFields = Object.keys(normalizedPayload).filter((key) => !piiKeys.has(key)).sort();
    await recordProfileAudit('HR_EMPLOYEE_PROFILE_UPDATED', updated, authContext, {
      changedFields,
      sensitiveFieldsChanged: Object.keys(normalizedPayload).some((key) => piiKeys.has(key)),
    });
    return toEmployeeProfileDetailDto(updated, { includeSensitive: canReadSensitive(authContext) });
  } catch (error) {
    throw duplicateError(error, 'Employee profile has duplicate fields');
  }
}

async function storeProfileAvatar(current, file, authContext = {}) {
  assertAvatarFile(file);
  const profileId = String(current._id || current.id);
  const asset = await mediaPublic.storeAsset({
    stream: Readable.from(file.buffer),
    filename: file.originalname,
    mimeType: file.mimetype,
    metadata: {
      source: 'HR_AVATAR',
      profileId: String(profileId),
      uploadedBy: authContext.accountId || null,
    },
    maxBytes: MAX_AVATAR_BYTES,
  });
  const avatarAssetId = String(asset._id || asset.id);
  let updated;
  try {
    updated = await repository.updateById(profileId, { avatarAssetId, avatarUrl: null });
  } catch (error) {
    await discardAvatarAsset(avatarAssetId, profileId, 'HR_AVATAR_PROFILE_UPDATE_FAILED');
    throw error;
  }
  if (current.avatarAssetId && String(current.avatarAssetId) !== avatarAssetId) {
    await discardAvatarAsset(String(current.avatarAssetId), profileId, 'HR_AVATAR_REPLACED');
  }
  await recordProfileAudit('HR_EMPLOYEE_AVATAR_UPDATED', updated, authContext);
  return toEmployeeProfileDetailDto(updated, { includeSensitive: canReadSensitive(authContext) });
}

async function uploadProfileAvatar(profileId, file, authContext = {}) {
  assertObjectId(profileId, 'profileId');
  const current = await repository.findById(profileId);
  if (!current || current.isDeleted) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  assertCanAccessProfile(authContext, current, [hrPermissions.EMPLOYEE_WRITE]);
  return storeProfileAvatar(current, file, authContext);
}

async function uploadMyProfileAvatar(file, authContext = {}) {
  if (!authContext.accountId) {
    throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }
  const current = await repository.findByAccountId(authContext.accountId);
  if (!current || current.isDeleted) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return storeProfileAvatar(current, file, authContext);
}

async function withProfileAvatar(profileId, authContext = {}, callback) {
  assertObjectId(profileId, 'profileId');
  const current = await repository.findById(profileId);
  if (!current || current.isDeleted || !current.avatarAssetId) {
    throw new AppError('Employee avatar not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  assertCanAccessProfile(authContext, current, [hrPermissions.EMPLOYEE_READ, hrPermissions.EMPLOYEE_WRITE]);
  return mediaPublic.withAssetLocalReadFile(current.avatarAssetId, callback);
}

async function withMyProfileAvatar(authContext = {}, callback) {
  if (!authContext.accountId) {
    throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }
  const current = await repository.findByAccountId(authContext.accountId);
  if (!current || current.isDeleted || !current.avatarAssetId) {
    throw new AppError('Employee avatar not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return mediaPublic.withAssetLocalReadFile(current.avatarAssetId, callback);
}

async function deleteProfile(profileId, authContext = {}) {
  assertObjectId(profileId, 'profileId');
  const current = await repository.findById(profileId);
  if (!current) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  assertCanAccessProfile(authContext, current, [hrPermissions.EMPLOYEE_WRITE]);
  if (current.isDeleted) return toEmployeeProfileDetailDto(current);
  const profile = await repository.softDelete(profileId);
  if (!profile) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  await recordProfileAudit('HR_EMPLOYEE_PROFILE_DELETED', profile, authContext);
  return toEmployeeProfileDetailDto(profile);
}

async function restoreProfile(profileId, authContext = {}) {
  assertObjectId(profileId, 'profileId');
  const current = await repository.findById(profileId);
  if (!current) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  assertCanAccessProfile(authContext, current, [hrPermissions.EMPLOYEE_WRITE]);
  if (!current.isDeleted) return toEmployeeProfileDetailDto(current);
  const profile = await repository.restore(profileId);
  if (!profile) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  await recordProfileAudit('HR_EMPLOYEE_PROFILE_RESTORED', profile, authContext);
  return toEmployeeProfileDetailDto(profile);
}

module.exports = {
  assertCanAccessProfile,
  createProfile,
  deleteProfile,
  getMyProfile,
  getProfile,
  listProfiles,
  restoreProfile,
  recordProfileAudit,
  resolveOrganization,
  updateMyPersonalProfile,
  updateProfile,
  uploadProfileAvatar,
  uploadMyProfileAvatar,
  withMyProfileAvatar,
  withProfileAvatar,
};
