const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const organizationPublic = require('../../organization/public');
const { hrEmployeeStatuses, hrTimePermissions } = require('../constants/hr.constants');
const {
  toAssignmentDto,
  toCalendarOverrideDto,
  toPaginatedDto,
  toShiftDto,
  toWorkLocationDto,
} = require('../dtos/schedule.dto');
const profileRepository = require('../repositories/employeeProfile.repository');
const repository = require('../repositories/schedule.repository');
const { getShiftDurationMinutes } = require('../validators/schedule.validator');

function conflict(message) {
  return new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function validationError(message) {
  return new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobalSchedulePermission(authContext, permissions) {
  return permissions.some((permission) => authPublic.canAccessScope(authContext, permission, {
    scopeType: 'global', scopeId: null,
  }));
}

function hasScopedSchedulePermission(authContext, permissions) {
  return (authContext.scopes || []).some((scope) => (
    ['team', 'department'].includes(scope.scopeType)
    && scope.scopeId
    && permissions.some((permission) => (scope.permissions || []).includes(permission))
  ));
}

function canAccessProfile(authContext, profile, permissions) {
  if (hasGlobalSchedulePermission(authContext, permissions)) return true;
  return permissions.some((permission) => authPublic.canAccessScope(authContext, permission, {
    scopeType: 'team', scopeId: profile.teamId || null,
  }) || authPublic.canAccessScope(authContext, permission, {
    scopeType: 'department', scopeId: profile.departmentId || null,
  }));
}

function assertCanAccessProfile(authContext, profile, permissions) {
  if (!canAccessProfile(authContext, profile, permissions)) throw forbidden();
}

function assertGlobalScheduleWrite(authContext) {
  if (!hasGlobalSchedulePermission(authContext, [hrTimePermissions.SCHEDULE_WRITE])) throw forbidden();
}

function scopedPage(result, items) {
  return {
    items,
    pagination: { ...result.pagination, total: items.length },
  };
}

async function actorSnapshot(authContext = {}) {
  const accountId = authContext.accountId || null;
  if (!accountId) return { accountId: null, fullName: null };
  const authModel = await authPublic.getCurrentAccount(accountId);
  return { accountId, fullName: authModel?.profile?.fullName || null };
}

function active(record) {
  return record && !record.isDeleted && record.status === hrEmployeeStatuses.ACTIVE;
}

function duplicateError(error, message) {
  return error?.code === 11000 ? conflict(message) : error;
}

async function assertActiveProfile(profileId) {
  const profile = await profileRepository.findById(profileId);
  if (!profile) throw notFound('Employee profile not found');
  if (!active(profile)) throw conflict('Employee profile is inactive');
  return profile;
}

async function assertActiveShift(shiftId) {
  const shift = await repository.findShiftById(shiftId);
  if (!shift) throw notFound('Shift not found');
  if (!active(shift)) throw conflict('Shift is inactive');
  return shift;
}

async function assertActiveWorkLocation(workLocationId) {
  if (!workLocationId) return null;
  const location = await repository.findWorkLocationById(workLocationId);
  if (!location) throw notFound('Work location not found');
  if (!active(location)) throw conflict('Work location is inactive');
  return location;
}

async function assertNoAssignmentOverlap(profileId, effectiveFrom, effectiveTo, excludedId) {
  const matches = await repository.findAssignmentOverlaps(profileId, effectiveFrom, effectiveTo, excludedId);
  if (matches.length) throw conflict('Shift assignment overlaps an active assignment');
}

function assertAssignmentDateRange({ effectiveFrom, effectiveTo }) {
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw validationError('Shift assignment effectiveTo must not precede effectiveFrom');
  }
}

function normalizeCalendarScope(payload) {
  if (payload.scopeType === 'GLOBAL') return { ...payload, scopeId: null };
  if (!payload.scopeId) throw validationError('Calendar override scopeId is required for a non-global scope');
  return payload;
}

function isActiveOrganizationRecord(record) {
  return String(record?.status || '').trim().toLowerCase() === 'active';
}

async function assertCalendarScope(scopeType, scopeId) {
  if (scopeType === 'GLOBAL') return;
  if (scopeType === 'PROFILE') return assertActiveProfile(scopeId);
  if (scopeType === 'WORK_LOCATION') return assertActiveWorkLocation(scopeId);
  if (scopeType === 'DEPARTMENT') {
    const department = await organizationPublic.getDepartmentById(scopeId);
    if (!department) throw notFound('Department not found');
    if (!isActiveOrganizationRecord(department)) throw conflict('Department is inactive');
    return department;
  }
  const team = await organizationPublic.getTeamById(scopeId);
  if (!team) throw notFound('Team not found');
  if (!isActiveOrganizationRecord(team)) throw conflict('Team is inactive');
  return team;
}

function assertShiftDuration(payload) {
  const duration = getShiftDurationMinutes(payload.startTime, payload.endTime);
  if (duration === null || duration > 960) {
    throw new AppError('Shift duration must not exceed 960 minutes', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

async function createWorkLocation(payload, authContext = {}) {
  assertGlobalScheduleWrite(authContext);
  try {
    return toWorkLocationDto(await repository.createWorkLocation(payload));
  } catch (error) {
    throw duplicateError(error, 'Work location code already exists');
  }
}

async function listWorkLocations(query) {
  return toPaginatedDto(await repository.listWorkLocations(query), toWorkLocationDto);
}

async function updateWorkLocation(id, payload, authContext = {}) {
  assertGlobalScheduleWrite(authContext);
  try {
    const updated = await repository.updateWorkLocationById(id, payload);
    if (!updated) throw notFound('Work location not found');
    return toWorkLocationDto(updated);
  } catch (error) {
    throw duplicateError(error, 'Work location code already exists');
  }
}

async function createShift(payload, authContext = {}) {
  assertGlobalScheduleWrite(authContext);
  if (payload.workLocationId) await assertActiveWorkLocation(payload.workLocationId);
  try {
    return toShiftDto(await repository.createShift(payload));
  } catch (error) {
    throw duplicateError(error, 'Shift code already exists');
  }
}

async function listShifts(query) {
  return toPaginatedDto(await repository.listShifts(query), toShiftDto);
}

async function updateShift(id, payload, authContext = {}) {
  assertGlobalScheduleWrite(authContext);
  const current = await repository.findShiftById(id);
  if (!current) throw notFound('Shift not found');
  const next = { ...current, ...payload };
  assertShiftDuration(next);
  if (next.workLocationId) await assertActiveWorkLocation(next.workLocationId);
  try {
    return toShiftDto(await repository.updateShiftById(id, payload));
  } catch (error) {
    throw duplicateError(error, 'Shift code already exists');
  }
}

async function createAssignment(payload, authContext) {
  const profile = await assertActiveProfile(payload.profileId);
  assertCanAccessProfile(authContext, profile, [hrTimePermissions.SCHEDULE_WRITE]);
  await assertActiveShift(payload.shiftId);
  await assertActiveWorkLocation(payload.workLocationId);
  assertAssignmentDateRange(payload);
  if (payload.status !== hrEmployeeStatuses.SUSPENDED) {
    await assertNoAssignmentOverlap(payload.profileId, payload.effectiveFrom, payload.effectiveTo);
  }
  return toAssignmentDto(await repository.createAssignment({ ...payload, createdBy: await actorSnapshot(authContext) }));
}

async function listAssignments(query, authContext = {}) {
  const permissions = [hrTimePermissions.SCHEDULE_READ, hrTimePermissions.SCHEDULE_WRITE];
  const result = await repository.listAssignments(query);
  if (hasGlobalSchedulePermission(authContext, permissions)) return toPaginatedDto(result, toAssignmentDto);
  if (!hasScopedSchedulePermission(authContext, permissions)) throw forbidden();
  // ponytail: filters the current page; add repository scope joins for exact cross-page pagination.
  const profiles = await Promise.all(result.items.map((assignment) => profileRepository.findById(assignment.profileId)));
  const items = result.items.filter((assignment, index) => profiles[index]
    && canAccessProfile(authContext, profiles[index], permissions));
  return toPaginatedDto(scopedPage(result, items), toAssignmentDto);
}

async function updateAssignment(id, payload, authContext) {
  const current = await repository.findAssignmentById(id);
  if (!current) throw notFound('Shift assignment not found');
  const currentProfile = await assertActiveProfile(current.profileId);
  assertCanAccessProfile(authContext, currentProfile, [hrTimePermissions.SCHEDULE_WRITE]);
  const next = { ...current, ...payload };
  assertAssignmentDateRange(next);
  const nextProfile = await assertActiveProfile(next.profileId);
  assertCanAccessProfile(authContext, nextProfile, [hrTimePermissions.SCHEDULE_WRITE]);
  await assertActiveShift(next.shiftId);
  await assertActiveWorkLocation(next.workLocationId);
  if (next.status !== hrEmployeeStatuses.SUSPENDED) {
    await assertNoAssignmentOverlap(next.profileId, next.effectiveFrom, next.effectiveTo, id);
  }
  const patch = { ...payload };
  if (payload.status === hrEmployeeStatuses.ACTIVE && current.status !== hrEmployeeStatuses.ACTIVE) {
    patch.createdBy = await actorSnapshot(authContext);
  }
  return toAssignmentDto(await repository.updateAssignmentById(id, patch));
}

async function assertNoCalendarConflict(dateKey, scopeType, scopeId, excludedId) {
  const match = await repository.findCalendarConflict(dateKey, scopeType, scopeId, excludedId);
  if (match) throw conflict('Calendar override already exists for this date and scope');
}

async function createCalendarOverride(payload, authContext) {
  const normalizedPayload = normalizeCalendarScope(payload);
  await assertCanWriteCalendarOverride(authContext, normalizedPayload);
  await assertCalendarScope(normalizedPayload.scopeType, normalizedPayload.scopeId);
  if (normalizedPayload.status !== hrEmployeeStatuses.SUSPENDED) {
    await assertNoCalendarConflict(normalizedPayload.dateKey, normalizedPayload.scopeType, normalizedPayload.scopeId);
  }
  try {
    return toCalendarOverrideDto(await repository.createCalendarOverride({
      ...normalizedPayload,
      createdBy: await actorSnapshot(authContext),
    }));
  } catch (error) {
    throw duplicateError(error, 'Calendar override already exists for this date and scope');
  }
}

async function listCalendarOverrides(query, authContext = {}) {
  const permissions = [hrTimePermissions.SCHEDULE_READ, hrTimePermissions.SCHEDULE_WRITE];
  const result = await repository.listCalendarOverrides(query);
  if (hasGlobalSchedulePermission(authContext, permissions)) return toPaginatedDto(result, toCalendarOverrideDto);
  if (!hasScopedSchedulePermission(authContext, permissions)) throw forbidden();
  // ponytail: filters the current page; add repository scope filters for exact cross-page pagination.
  const access = await Promise.all(result.items.map((override) => canReadCalendarOverride(authContext, override, permissions)));
  return toPaginatedDto(scopedPage(result, result.items.filter((_override, index) => access[index])), toCalendarOverrideDto);
}

async function updateCalendarOverride(id, payload, authContext) {
  const current = await repository.findCalendarOverrideById(id);
  if (!current) throw notFound('Calendar override not found');
  await assertCanWriteCalendarOverride(authContext, current);
  const next = normalizeCalendarScope({ ...current, ...payload });
  await assertCanWriteCalendarOverride(authContext, next);
  await assertCalendarScope(next.scopeType, next.scopeId);
  if (next.status !== hrEmployeeStatuses.SUSPENDED) {
    await assertNoCalendarConflict(next.dateKey, next.scopeType, next.scopeId, id);
  }
  const patch = next.scopeType === 'GLOBAL' ? { ...payload, scopeId: null } : { ...payload };
  if (payload.status === hrEmployeeStatuses.ACTIVE && current.status !== hrEmployeeStatuses.ACTIVE) {
    patch.createdBy = await actorSnapshot(authContext);
  }
  try {
    return toCalendarOverrideDto(await repository.updateCalendarOverrideById(id, patch));
  } catch (error) {
    throw duplicateError(error, 'Calendar override already exists for this date and scope');
  }
}

async function assertCanWriteCalendarOverride(authContext, override) {
  if (['GLOBAL', 'WORK_LOCATION'].includes(override.scopeType)) {
    assertGlobalScheduleWrite(authContext);
    return;
  }
  if (['DEPARTMENT', 'TEAM'].includes(override.scopeType)) {
    if (!authPublic.canAccessScope(authContext, hrTimePermissions.SCHEDULE_WRITE, {
      scopeType: override.scopeType.toLowerCase(), scopeId: override.scopeId,
    })) throw forbidden();
    return;
  }
  const profile = await assertActiveProfile(override.scopeId);
  assertCanAccessProfile(authContext, profile, [hrTimePermissions.SCHEDULE_WRITE]);
}

async function canReadCalendarOverride(authContext, override, permissions) {
  if (override.scopeType === 'GLOBAL') return true;
  if (['DEPARTMENT', 'TEAM'].includes(override.scopeType)) {
    return permissions.some((permission) => authPublic.canAccessScope(authContext, permission, {
      scopeType: override.scopeType.toLowerCase(), scopeId: override.scopeId,
    }));
  }
  if (override.scopeType !== 'PROFILE') return false;
  const profile = await profileRepository.findById(override.scopeId);
  return Boolean(profile && canAccessProfile(authContext, profile, permissions));
}

module.exports = {
  assertNoAssignmentOverlap,
  createAssignment,
  createCalendarOverride,
  createShift,
  createWorkLocation,
  listAssignments,
  listCalendarOverrides,
  listShifts,
  listWorkLocations,
  updateAssignment,
  updateCalendarOverride,
  updateShift,
  updateWorkLocation,
};
