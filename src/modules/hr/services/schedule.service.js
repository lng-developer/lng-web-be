const crypto = require('crypto');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const auditPublic = require('../../audit/public');
const organizationPublic = require('../../organization/public');
const logger = require('../../../shared/utils/logger');
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

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function scheduleAuditScope(record = {}, profile = null) {
  if (['TEAM', 'DEPARTMENT'].includes(record.scopeType) && record.scopeId) {
    return { scopeType: record.scopeType, scopeId: toId(record.scopeId) };
  }
  const target = profile || {};
  if (target.teamId) return { scopeType: 'TEAM', scopeId: toId(target.teamId) };
  if (target.departmentId) return { scopeType: 'DEPARTMENT', scopeId: toId(target.departmentId) };
  return { scopeType: null, scopeId: null };
}

async function recordScheduleAudit(action, entityType, record, authContext = {}, {
  profile = null, metadata = {},
} = {}) {
  const entityId = toId(record);
  try {
    await auditPublic.record({
      actorType: authContext.accountId ? 'ACCOUNT' : 'SYSTEM',
      actorAccountId: authContext.accountId || null,
      actorSnapshot: {},
      action,
      entityType,
      entityId,
      ...scheduleAuditScope(record, profile),
      outcome: 'SUCCEEDED',
      source: 'HTTP',
      changes: null,
      metadata,
      deduplicationKey: `hr:${action.toLowerCase()}:${entityId}:${crypto.randomUUID()}`,
    }, {});
  } catch (error) {
    logger.warn('hr_schedule_audit_write_failed', { action, entityId, error });
  }
}

function toEmployeeSummary(profile) {
  if (!profile) return null;
  return { id: toId(profile), employeeCode: profile.employeeCode || null, fullName: profile.fullName || null };
}

function toRecordSummary(record) {
  if (!record) return null;
  return { id: toId(record), code: record.code || null, name: record.name || null };
}

function hasGlobalSchedulePermission(authContext, permissions) {
  return permissions.some((permission) => authPublic.canAccessScope(authContext, permission, {
    scopeType: 'global', scopeId: null,
  }));
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

function profileScopeFilters(authContext, permissions) {
  return (authContext.scopes || []).flatMap((scope) => {
    if (!permissions.some((permission) => (scope.permissions || []).includes(permission))) return [];
    if (scope.scopeType === 'team' && scope.scopeId) return [{ teamId: String(scope.scopeId) }];
    if (scope.scopeType === 'department' && scope.scopeId) return [{ departmentId: String(scope.scopeId) }];
    return [];
  });
}

async function scopedProfileIds(authContext, permissions) {
  const scopeFilters = profileScopeFilters(authContext, permissions);
  if (!scopeFilters.length) throw forbidden();
  const profiles = await profileRepository.listIds({ scopeFilters });
  return profiles.map((profile) => String(profile._id || profile.id));
}

function calendarScopeFilters(authContext, permissions, profileIds) {
  const directScopeFilters = (authContext.scopes || []).flatMap((scope) => {
    if (!permissions.some((permission) => (scope.permissions || []).includes(permission))) return [];
    if (scope.scopeType === 'team' && scope.scopeId) {
      return [{ scopeType: 'TEAM', scopeId: String(scope.scopeId) }];
    }
    if (scope.scopeType === 'department' && scope.scopeId) {
      return [{ scopeType: 'DEPARTMENT', scopeId: String(scope.scopeId) }];
    }
    return [];
  });
  return [
    { scopeType: 'GLOBAL', scopeId: null },
    ...directScopeFilters,
    ...(profileIds.length ? [{ scopeType: 'PROFILE', scopeId: { $in: profileIds } }] : []),
  ];
}

async function actorSnapshot(authContext = {}) {
  const accountId = authContext.accountId || null;
  if (!accountId) return { accountId: null, fullName: null };
  const profile = await profileRepository.findByAccountId(accountId);
  if (profile?.fullName) return { accountId, fullName: profile.fullName };
  const authModel = await authPublic.getCurrentAccount(accountId);
  return { accountId, fullName: authModel?.account?.email || null };
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

async function assertCalendarScope(scopeType, scopeId, profile = null) {
  if (scopeType === 'GLOBAL') return;
  if (scopeType === 'PROFILE') return profile || assertActiveProfile(scopeId);
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
    const created = await repository.createWorkLocation(payload);
    await recordScheduleAudit('HR_WORK_LOCATION_CREATED', 'HR_WORK_LOCATION', created, authContext, {
      metadata: { status: created.status || null },
    });
    return toWorkLocationDto(created);
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
    await recordScheduleAudit('HR_WORK_LOCATION_UPDATED', 'HR_WORK_LOCATION', updated, authContext, {
      metadata: { changedFields: Object.keys(payload).sort() },
    });
    return toWorkLocationDto(updated);
  } catch (error) {
    throw duplicateError(error, 'Work location code already exists');
  }
}

async function createShift(payload, authContext = {}) {
  assertGlobalScheduleWrite(authContext);
  if (payload.workLocationId) await assertActiveWorkLocation(payload.workLocationId);
  try {
    const created = await repository.createShift(payload);
    await recordScheduleAudit('HR_SHIFT_CREATED', 'HR_SHIFT', created, authContext, {
      metadata: { status: created.status || null },
    });
    return toShiftDto(created);
  } catch (error) {
    throw duplicateError(error, 'Shift code already exists');
  }
}

async function listShifts(query) {
  const result = await repository.listShifts(query);
  const locationIds = [...new Set((result.items || []).map((shift) => toId(shift.workLocationId)).filter(Boolean))];
  const locations = locationIds.length ? await repository.findWorkLocationsByIds(locationIds) : [];
  const locationsById = new Map(locations.map((location) => [toId(location), location]));

  return toPaginatedDto(result, (shift) => toShiftDto(shift, {
    workLocation: locationsById.get(toId(shift.workLocationId)) || null,
  }));
}

async function updateShift(id, payload, authContext = {}) {
  assertGlobalScheduleWrite(authContext);
  const current = await repository.findShiftById(id);
  if (!current) throw notFound('Shift not found');
  const next = { ...current, ...payload };
  assertShiftDuration(next);
  if (next.workLocationId) await assertActiveWorkLocation(next.workLocationId);
  try {
    const updated = await repository.updateShiftById(id, payload);
    await recordScheduleAudit('HR_SHIFT_UPDATED', 'HR_SHIFT', updated, authContext, {
      metadata: { changedFields: Object.keys(payload).sort() },
    });
    return toShiftDto(updated);
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
  const created = await repository.createAssignment({ ...payload, createdBy: await actorSnapshot(authContext) });
  await recordScheduleAudit('HR_SHIFT_ASSIGNMENT_CREATED', 'HR_SHIFT_ASSIGNMENT', created, authContext, {
    profile,
    metadata: {
      profileId: toId(profile),
      shiftId: toId(created.shiftId),
      workLocationId: toId(created.workLocationId),
    },
  });
  return toAssignmentDto(created);
}

async function assignmentPage(result, authContext) {
  const items = result.items || [];
  const [profiles, shifts, workLocations] = await Promise.all([
    profileRepository.listByIds?.(items.map((item) => item.profileId)) || [],
    repository.findShiftsByIds?.(items.map((item) => item.shiftId)) || [],
    repository.findWorkLocationsByIds?.(items.map((item) => item.workLocationId)) || [],
  ]);
  const profilesById = new Map(profiles.map((profile) => [toId(profile), profile]));
  const shiftsById = new Map(shifts.map((shift) => [toId(shift), shift]));
  const workLocationsById = new Map(workLocations.map((workLocation) => [toId(workLocation), workLocation]));
  const page = toPaginatedDto(result, (assignment) => {
    const profile = profilesById.get(toId(assignment.profileId));
    return toAssignmentDto(assignment, {
      employee: toEmployeeSummary(profile),
      shift: toRecordSummary(shiftsById.get(toId(assignment.shiftId))),
      workLocation: toRecordSummary(workLocationsById.get(toId(assignment.workLocationId))),
      capabilities: { view: true, edit: Boolean(profile && canAccessProfile(authContext, profile, [hrTimePermissions.SCHEDULE_WRITE])) },
    });
  });
  return result.summary ? { ...page, summary: result.summary } : page;
}

async function listAssignments(query, authContext = {}) {
  const permissions = [hrTimePermissions.SCHEDULE_READ, hrTimePermissions.SCHEDULE_WRITE];
  if (hasGlobalSchedulePermission(authContext, permissions)) {
    return assignmentPage(await repository.listAssignments(query), authContext);
  }
  const profileIds = await scopedProfileIds(authContext, permissions);
  return assignmentPage(await repository.listAssignments({ ...query, profileIds }), authContext);
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
  const updated = await repository.updateAssignmentById(id, patch);
  await recordScheduleAudit('HR_SHIFT_ASSIGNMENT_UPDATED', 'HR_SHIFT_ASSIGNMENT', updated, authContext, {
    profile: nextProfile,
    metadata: { profileId: toId(nextProfile), changedFields: Object.keys(payload).sort() },
  });
  return toAssignmentDto(updated);
}

async function assertNoCalendarConflict(dateKey, scopeType, scopeId, excludedId) {
  const match = await repository.findCalendarConflict(dateKey, scopeType, scopeId, excludedId);
  if (match) throw conflict('Calendar override already exists for this date and scope');
}

async function createCalendarOverride(payload, authContext) {
  const normalizedPayload = normalizeCalendarScope(payload);
  const profile = await assertCanWriteCalendarOverride(authContext, normalizedPayload);
  await assertCalendarScope(normalizedPayload.scopeType, normalizedPayload.scopeId, profile);
  if (normalizedPayload.status !== hrEmployeeStatuses.SUSPENDED) {
    await assertNoCalendarConflict(normalizedPayload.dateKey, normalizedPayload.scopeType, normalizedPayload.scopeId);
  }
  try {
    const created = await repository.createCalendarOverride({
      ...normalizedPayload,
      createdBy: await actorSnapshot(authContext),
    });
    await recordScheduleAudit('HR_CALENDAR_OVERRIDE_CREATED', 'HR_CALENDAR_OVERRIDE', created, authContext, {
      profile,
      metadata: { dateKey: created.dateKey, kind: created.kind || null },
    });
    return toCalendarOverrideDto(created);
  } catch (error) {
    throw duplicateError(error, 'Calendar override already exists for this date and scope');
  }
}

async function listCalendarOverrides(query, authContext = {}) {
  const permissions = [hrTimePermissions.SCHEDULE_READ, hrTimePermissions.SCHEDULE_WRITE];
  let result;
  if (hasGlobalSchedulePermission(authContext, permissions)) {
    result = await repository.listCalendarOverrides(query);
  } else {
    const profileIds = await scopedProfileIds(authContext, permissions);
    result = await repository.listCalendarOverrides({
      ...query,
      scopeFilters: calendarScopeFilters(authContext, permissions, profileIds),
    });
  }
  const items = result.items || [];
  const [profiles, departments, teams, workLocations] = await Promise.all([
    profileRepository.listByIds?.(items
    .filter((override) => override.scopeType === 'PROFILE')
    .map((override) => override.scopeId)) || [],
    organizationPublic.listDepartmentsByIds(items
      .filter((override) => override.scopeType === 'DEPARTMENT')
      .map((override) => override.scopeId)),
    organizationPublic.listTeamsByIds(items
      .filter((override) => override.scopeType === 'TEAM')
      .map((override) => override.scopeId)),
    repository.findWorkLocationsByIds?.(items
      .filter((override) => override.scopeType === 'WORK_LOCATION')
      .map((override) => override.scopeId)) || [],
  ]);
  const profilesById = new Map(profiles.map((profile) => [toId(profile), profile]));
  const departmentsById = new Map(departments.map((department) => [toId(department), department]));
  const teamsById = new Map(teams.map((team) => [toId(team), team]));
  const workLocationsById = new Map(workLocations.map((workLocation) => [toId(workLocation), workLocation]));
  return toPaginatedDto(result, (override) => {
    const profile = override.scopeType === 'PROFILE' ? profilesById.get(toId(override.scopeId)) : null;
    const fallbackScopeTarget = { id: toId(override.scopeId), type: override.scopeType || null, name: override.scopeType === 'GLOBAL' ? 'Global' : null };
    const scopeTarget = profile
      ? toEmployeeSummary(profile)
      : override.scopeType === 'DEPARTMENT'
        ? toRecordSummary(departmentsById.get(toId(override.scopeId))) || fallbackScopeTarget
        : override.scopeType === 'TEAM'
          ? toRecordSummary(teamsById.get(toId(override.scopeId))) || fallbackScopeTarget
          : override.scopeType === 'WORK_LOCATION'
            ? toRecordSummary(workLocationsById.get(toId(override.scopeId))) || fallbackScopeTarget
            : fallbackScopeTarget;
    const canEdit = ['GLOBAL', 'WORK_LOCATION'].includes(override.scopeType)
      ? hasGlobalSchedulePermission(authContext, [hrTimePermissions.SCHEDULE_WRITE])
      : ['DEPARTMENT', 'TEAM'].includes(override.scopeType)
        ? authPublic.canAccessScope(authContext, hrTimePermissions.SCHEDULE_WRITE, {
          scopeType: override.scopeType.toLowerCase(), scopeId: override.scopeId,
        })
        : Boolean(profile && canAccessProfile(authContext, profile, [hrTimePermissions.SCHEDULE_WRITE]));
    return toCalendarOverrideDto(override, { scopeTarget, capabilities: { view: true, edit: canEdit } });
  });
}

async function updateCalendarOverride(id, payload, authContext) {
  const current = await repository.findCalendarOverrideById(id);
  if (!current) throw notFound('Calendar override not found');
  await assertCanWriteCalendarOverride(authContext, current);
  const next = normalizeCalendarScope({ ...current, ...payload });
  const profile = await assertCanWriteCalendarOverride(authContext, next);
  await assertCalendarScope(next.scopeType, next.scopeId, profile);
  if (next.status !== hrEmployeeStatuses.SUSPENDED) {
    await assertNoCalendarConflict(next.dateKey, next.scopeType, next.scopeId, id);
  }
  const patch = next.scopeType === 'GLOBAL' ? { ...payload, scopeId: null } : { ...payload };
  if (payload.status === hrEmployeeStatuses.ACTIVE && current.status !== hrEmployeeStatuses.ACTIVE) {
    patch.createdBy = await actorSnapshot(authContext);
  }
  try {
    const updated = await repository.updateCalendarOverrideById(id, patch);
    await recordScheduleAudit('HR_CALENDAR_OVERRIDE_UPDATED', 'HR_CALENDAR_OVERRIDE', updated, authContext, {
      profile,
      metadata: { dateKey: updated.dateKey, kind: updated.kind || null },
    });
    return toCalendarOverrideDto(updated);
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
  return profile;
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
