const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const organizationPublic = require('../../organization/public');
const { hrHolidayTypes } = require('../constants/hr.constants');
const {
  toHolidayDto,
  toPaginatedDto,
  toRotationDto,
  toScheduleSnapshotDto,
} = require('../dtos/calendarPolicy.dto');
const repository = require('../repositories/calendarPolicy.repository');
const scheduleResolver = require('./scheduleResolver.service');

function operationalError(message, statusCode, code) {
  return new AppError(message, statusCode, true, code);
}

function validationError(message) {
  return operationalError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
}

function notFound(message) {
  return operationalError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return operationalError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobalPermission(authContext, permissions) {
  return permissions.some((permission) => (authContext?.permissions || []).includes(permission));
}

function canAccessAny(authContext, permissions, scope) {
  return permissions.some((permission) => authPublic.canAccessScope(authContext, permission, scope));
}

function assertTeamAccess(authContext, permissions, teamId) {
  if (!authContext || hasGlobalPermission(authContext, permissions)) return;
  if (!canAccessAny(authContext, permissions, { scopeType: 'team', scopeId: teamId })) throw forbidden();
}

function assertHolidayAccess(authContext, permissions, holiday, { requireAll = false } = {}) {
  if (!authContext || hasGlobalPermission(authContext, permissions)) return;
  const scopes = [
    ...(holiday.appliedDepartmentIds || []).map((scopeId) => ({ scopeType: 'department', scopeId })),
    ...(holiday.appliedTeamIds || []).map((scopeId) => ({ scopeType: 'team', scopeId })),
  ];
  if (!scopes.length) scopes.push({ scopeType: 'global', scopeId: null });
  const decisions = scopes.map((scope) => canAccessAny(authContext, permissions, scope));
  if (requireAll ? decisions.some((allowed) => !allowed) : !decisions.some(Boolean)) throw forbidden();
}

const scheduleReadPermissions = ['HR_SCHEDULE:READ', 'HR_SCHEDULE:WRITE'];
const scheduleWritePermissions = ['HR_SCHEDULE:WRITE'];

function duplicateError(error, message) {
  if (error?.code === 11000) return operationalError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
  return error;
}

function toDateKeyInHoChiMinh(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const exactDate = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(exactDate.getTime()) && exactDate.toISOString().slice(0, 10) === value) return value;
    throw validationError('Holiday date is invalid');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError('Holiday date is invalid');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function normalizeHoliday(payload) {
  return {
    name: payload.name,
    dateKey: toDateKeyInHoChiMinh(payload.dateKey || payload.date),
    isWorkDay: Boolean(payload.isWorkDay),
    holidayType: payload.holidayType,
    appliedDepartmentIds: uniqueIds(payload.appliedDepartmentIds),
    appliedTeamIds: uniqueIds(payload.appliedTeamIds),
    note: payload.note || null,
    isActive: payload.isActive ?? true,
  };
}

async function assertOrganizationScopes(holiday) {
  await Promise.all([
    ...holiday.appliedDepartmentIds.map((id) => organizationPublic.getDepartmentById(id)),
    ...holiday.appliedTeamIds.map((id) => organizationPublic.getTeamById(id)),
  ]);
}

async function resolveCalendarPolicy({ profileId, workDateKey } = {}) {
  const schedule = await scheduleResolver.resolveWorkContext({ profileId, workDateKey });
  const scope = schedule.profile || {};
  const [holiday, isRotationOff] = await Promise.all([
    repository.findApplicable({ workDateKey, dateKey: workDateKey, ...scope }),
    repository.isRotationOff(profileId, workDateKey),
  ]);
  return {
    isSunday: new Date(`${workDateKey}T00:00:00.000Z`).getUTCDay() === 0,
    isRotationOff,
    holiday: toHolidayDto(holiday),
    scheduleSnapshot: toScheduleSnapshotDto(schedule),
  };
}

async function createHoliday(payload, authContext) {
  const holiday = normalizeHoliday(payload);
  assertHolidayAccess(authContext, scheduleWritePermissions, holiday, { requireAll: true });
  await assertOrganizationScopes(holiday);
  try {
    return toHolidayDto(await repository.upsertHoliday(holiday));
  } catch (error) {
    throw duplicateError(error, 'Holiday already exists for this date');
  }
}

async function getHoliday(id, authContext) {
  const holiday = await repository.findHolidayById(id);
  if (!holiday) throw notFound('Holiday not found');
  assertHolidayAccess(authContext, scheduleReadPermissions, holiday);
  return toHolidayDto(holiday);
}

async function listHolidays(query, authContext) {
  assertHolidayAccess(authContext, scheduleReadPermissions, {
    appliedDepartmentIds: query.departmentId ? [query.departmentId] : [],
    appliedTeamIds: query.teamId ? [query.teamId] : [],
  });
  return toPaginatedDto(await repository.listHolidays(query), toHolidayDto);
}

async function listHolidayRange(query, authContext) {
  assertHolidayAccess(authContext, scheduleReadPermissions, {
    appliedDepartmentIds: query.departmentId ? [query.departmentId] : [],
    appliedTeamIds: query.teamId ? [query.teamId] : [],
  });
  if (query.dateFrom > query.dateTo) throw validationError('dateFrom must be before or equal to dateTo');
  return { items: (await repository.listHolidayRange(query)).map(toHolidayDto) };
}

async function checkHoliday(query, authContext) {
  assertHolidayAccess(authContext, scheduleReadPermissions, {
    appliedDepartmentIds: query.departmentId ? [query.departmentId] : [],
    appliedTeamIds: query.teamId ? [query.teamId] : [],
  });
  const holiday = await repository.findApplicable(query);
  return { dateKey: query.dateKey, holiday: toHolidayDto(holiday) };
}

async function summarizeHolidays(year, authContext) {
  assertHolidayAccess(authContext, scheduleReadPermissions, { appliedDepartmentIds: [], appliedTeamIds: [] });
  const items = await repository.listHolidayRange({ dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` });
  return {
    year,
    total: items.length,
    publicHolidays: items.filter((item) => item.holidayType === hrHolidayTypes.PUBLIC_HOLIDAY).length,
    substituteWorkDays: items.filter((item) => item.holidayType === hrHolidayTypes.SUBSTITUTE_WORK_DAY).length,
    paidDays: items.filter((item) => item.holidayType === hrHolidayTypes.PUBLIC_HOLIDAY && !item.isWorkDay).length,
  };
}

async function updateHoliday(id, payload, authContext) {
  const current = await repository.findHolidayById(id);
  if (!current) throw notFound('Holiday not found');
  assertHolidayAccess(authContext, scheduleWritePermissions, current, { requireAll: true });
  const patch = normalizeHoliday({ ...current, ...payload });
  assertHolidayAccess(authContext, scheduleWritePermissions, patch, { requireAll: true });
  await assertOrganizationScopes(patch);
  try {
    return toHolidayDto(await repository.updateHoliday(id, patch));
  } catch (error) {
    throw duplicateError(error, 'Holiday already exists for this date');
  }
}

async function deleteHoliday(id, authContext) {
  const current = await repository.findHolidayById(id);
  if (!current) throw notFound('Holiday not found');
  assertHolidayAccess(authContext, scheduleWritePermissions, current, { requireAll: true });
  const holiday = await repository.softDeleteHoliday(id);
  return toHolidayDto(holiday);
}

async function bulkImportHolidays({ items }, authContext) {
  const normalized = items.map(normalizeHoliday);
  if (new Set(normalized.map((item) => item.dateKey)).size !== normalized.length) {
    throw validationError('Bulk holiday dates must be unique');
  }
  normalized.forEach((holiday) => assertHolidayAccess(authContext, scheduleWritePermissions, holiday, { requireAll: true }));
  await Promise.all(normalized.map(assertOrganizationScopes));
  const imported = [];
  for (const holiday of normalized) imported.push(toHolidayDto(await repository.upsertHoliday(holiday)));
  return { imported: imported.length, items: imported };
}

function listHolidayTemplates() {
  return { items: Object.values(hrHolidayTypes).map((holidayType) => ({
    holidayType,
    isWorkDay: holidayType === hrHolidayTypes.SUBSTITUTE_WORK_DAY,
    isPaid: holidayType === hrHolidayTypes.PUBLIC_HOLIDAY,
  })) };
}

function saturdaysInMonth(year, month) {
  const items = [];
  const date = new Date(Date.UTC(year, month - 1, 1));
  while (date.getUTCMonth() === month - 1) {
    if (date.getUTCDay() === 6) items.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return items;
}

function activeProfileIds(teamMembers) {
  return uniqueIds([...(teamMembers.leaders || []), ...(teamMembers.members || [])].map((member) => member.profileId));
}

function validateOffProfiles(profileIds, memberIds, maxOff) {
  const ids = uniqueIds(profileIds);
  if (ids.length !== (profileIds || []).length) throw validationError('Rotation employee profiles must be unique');
  if (ids.some((id) => !memberIds.includes(id))) throw validationError('Rotation employee must be an active team member');
  if (ids.length > maxOff) throw validationError('Rotation exceeds the maximum employees off');
  return ids;
}

async function getTeamContext(teamId, minPresent) {
  const members = activeProfileIds(await organizationPublic.listTeamMembers(teamId));
  if (!members.length) throw validationError('Team has no active employee profiles');
  const requiredPresent = minPresent ?? 1;
  if (requiredPresent > members.length) throw validationError('minPresent exceeds active team members');
  return { members, minPresent: requiredPresent, maxOff: members.length - requiredPresent };
}

async function generateRotations({ teamId, month, year, minPresent, customRotations = [] }, authContext) {
  assertTeamAccess(authContext, scheduleWritePermissions, teamId);
  const { members, minPresent: requiredPresent, maxOff } = await getTeamContext(teamId, minPresent);
  const saturdays = saturdaysInMonth(year, month);
  const custom = new Map();
  for (const item of customRotations) {
    if (!saturdays.includes(item.dateKey)) throw validationError('Custom rotation date must be a Saturday in the requested month');
    if (custom.has(item.dateKey)) throw validationError('Custom rotation dates must be unique');
    custom.set(item.dateKey, validateOffProfiles(item.employeeProfileIds, members, maxOff));
  }

  let cursor = 0;
  const items = [];
  for (const workDateKey of saturdays) {
    let employeeProfileIds = custom.get(workDateKey);
    if (!employeeProfileIds) {
      employeeProfileIds = Array.from({ length: maxOff }, (_, offset) => members[(cursor + offset) % members.length]);
      cursor = (cursor + Math.max(maxOff, 1)) % members.length;
    }
    items.push(toRotationDto(await repository.upsertRotation({
      teamId, workDateKey, month, year, employeeProfileIds, minPresent: requiredPresent,
    })));
  }
  return { generated: items.length, items };
}

async function listRotations(query, authContext) {
  if (!query.teamId && authContext && !hasGlobalPermission(authContext, scheduleReadPermissions)) throw forbidden();
  if (query.teamId) assertTeamAccess(authContext, scheduleReadPermissions, query.teamId);
  return toPaginatedDto(await repository.listRotations(query), toRotationDto);
}

async function updateRotation(id, { employeeProfileIds }, authContext) {
  const current = await repository.findRotationById(id);
  if (!current) throw notFound('Saturday rotation not found');
  assertTeamAccess(authContext, scheduleWritePermissions, current.teamId);
  const { members, maxOff } = await getTeamContext(String(current.teamId), current.minPresent);
  const updated = await repository.updateRotation(id, {
    employeeProfileIds: validateOffProfiles(employeeProfileIds, members, maxOff),
  });
  return toRotationDto(updated);
}

async function deleteRotation(id, authContext) {
  const current = await repository.findRotationById(id);
  if (!current) throw notFound('Saturday rotation not found');
  assertTeamAccess(authContext, scheduleWritePermissions, current.teamId);
  const rotation = await repository.deleteRotation(id);
  return toRotationDto(rotation);
}

async function deleteTeamRotations(teamId, { month, year }, authContext) {
  assertTeamAccess(authContext, scheduleWritePermissions, teamId);
  const result = await repository.deleteTeamRotations(teamId, month, year);
  return { deleted: result.deletedCount || 0 };
}

module.exports = {
  bulkImportHolidays,
  checkHoliday,
  createHoliday,
  deleteHoliday,
  deleteRotation,
  deleteTeamRotations,
  generateRotations,
  getHoliday,
  listHolidayRange,
  listHolidayTemplates,
  listHolidays,
  listRotations,
  resolveCalendarPolicy,
  summarizeHolidays,
  updateHoliday,
  updateRotation,
};
