const crypto = require('crypto');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const auditPublic = require('../../audit/public');
const organizationPublic = require('../../organization/public');
const logger = require('../../../shared/utils/logger');
const { hrHolidayTypes } = require('../constants/hr.constants');
const {
  toHolidayDto,
  toPaginatedDto,
  toRotationDto,
  toScheduleSnapshotDto,
} = require('../dtos/calendarPolicy.dto');
const repository = require('../repositories/calendarPolicy.repository');
const profileRepository = require('../repositories/employeeProfile.repository');
const scheduleResolver = require('./scheduleResolver.service');

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function calendarAuditScope(record = {}) {
  if (record.teamId) return { scopeType: 'TEAM', scopeId: toId(record.teamId) };
  const teamIds = record.appliedTeamIds || [];
  const departmentIds = record.appliedDepartmentIds || [];
  if (teamIds.length === 1 && !departmentIds.length) {
    return { scopeType: 'TEAM', scopeId: toId(teamIds[0]) };
  }
  if (departmentIds.length === 1 && !teamIds.length) {
    return { scopeType: 'DEPARTMENT', scopeId: toId(departmentIds[0]) };
  }
  return { scopeType: null, scopeId: null };
}

function calendarMutationIdentity(record = {}, operationKey = null) {
  if (operationKey) return `operation:${operationKey}`;
  return crypto.randomUUID();
}

async function recordCalendarAudit(action, entityType, record, authContext = {}, {
  source = 'HTTP', metadata = {}, operationKey = null,
} = {}) {
  const entityId = toId(record);
  try {
    await auditPublic.record({
      actorType: authContext?.accountId ? 'ACCOUNT' : 'SYSTEM',
      actorAccountId: authContext?.accountId || null,
      actorSnapshot: {},
      action,
      entityType,
      entityId,
      ...calendarAuditScope(record),
      outcome: 'SUCCEEDED',
      source,
      changes: null,
      metadata,
      deduplicationKey: `hr:${action.toLowerCase()}:${entityId}:${calendarMutationIdentity(record, operationKey)}`,
    }, {});
  } catch (error) {
    logger.warn('hr_calendar_audit_write_failed', { action, entityId, error });
  }
}

function operationalError(message, statusCode, code) {
  return new AppError(message, statusCode, true, code);
}

function validationError(message) {
  return operationalError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
}

function notFound(message) {
  return operationalError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function conflictError(message) {
  return operationalError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
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

const calendarReadPermissions = ['HR_CALENDAR:READ', 'HR_CALENDAR:WRITE'];
const calendarWritePermissions = ['HR_CALENDAR:WRITE'];
const rotationWritePermissions = [...calendarWritePermissions, 'HR_SATURDAY_ROTATION:WRITE'];
const rotationReadPermissions = [...calendarReadPermissions, 'HR_SATURDAY_ROTATION:WRITE'];

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

function normalizeHoliday(payload, fallbackDateKey) {
  return {
    name: payload.name,
    dateKey: toDateKeyInHoChiMinh(payload.dateKey ?? payload.date ?? fallbackDateKey),
    isWorkDay: Boolean(payload.isWorkDay),
    holidayType: payload.holidayType || hrHolidayTypes.PUBLIC_HOLIDAY,
    appliedDepartmentIds: uniqueIds(payload.appliedDepartmentIds),
    appliedTeamIds: uniqueIds(payload.appliedTeamIds),
    note: payload.note || null,
    isActive: payload.isActive ?? true,
  };
}

async function assertOrganizationScopes(holiday) {
  await Promise.all([
    ...holiday.appliedDepartmentIds.map(async (id) => {
      const department = await organizationPublic.getDepartmentById(id);
      if (!department) throw notFound('Department not found');
      if (String(department.status || '').toLowerCase() !== 'active') throw conflictError('Department is inactive');
    }),
    ...holiday.appliedTeamIds.map(async (id) => {
      const team = await organizationPublic.getTeamById(id);
      if (!team) throw notFound('Team not found');
      if (String(team.status || '').toLowerCase() !== 'active') throw conflictError('Team is inactive');
    }),
  ]);
}

function hasHolidayChanges(current, next) {
  return Object.entries(next).some(([key, value]) => (
    Array.isArray(value)
      ? JSON.stringify((current[key] || []).map(String)) !== JSON.stringify(value.map(String))
      : (current[key] ?? null) !== (value ?? null)
  ));
}

async function resolveCalendarPolicy({ profileId, workDateKey } = {}) {
  const schedule = await scheduleResolver.resolveWorkContext({ profileId, workDateKey });
  const holiday = toHolidayDto(schedule.holiday);
  return {
    isSunday: new Date(`${workDateKey}T00:00:00.000Z`).getUTCDay() === 0,
    isRotationOff: Boolean(schedule.isRotationOff),
    holiday: holiday ? { ...holiday, isApplicable: true } : null,
    scheduleSnapshot: toScheduleSnapshotDto(schedule),
  };
}

async function createHoliday(payload, authContext) {
  const holiday = normalizeHoliday(payload);
  assertHolidayAccess(authContext, calendarWritePermissions, holiday, { requireAll: true });
  await assertOrganizationScopes(holiday);
  try {
    const created = await repository.createHoliday(holiday);
    await recordCalendarAudit('HR_HOLIDAY_CREATED', 'HR_HOLIDAY', created, authContext, {
      metadata: {
        dateKey: created.dateKey,
        holidayType: created.holidayType,
        isWorkDay: Boolean(created.isWorkDay),
      },
    });
    return toHolidayDto(created);
  } catch (error) {
    throw duplicateError(error, 'Holiday already exists for this date');
  }
}

async function getHoliday(id, authContext) {
  const holiday = await repository.findHolidayById(id);
  if (!holiday) throw notFound('Holiday not found');
  assertHolidayAccess(authContext, calendarReadPermissions, holiday);
  return toHolidayDto(holiday);
}

async function listHolidays(query, authContext) {
  assertHolidayAccess(authContext, calendarReadPermissions, {
    appliedDepartmentIds: query.departmentId ? [query.departmentId] : [],
    appliedTeamIds: query.teamId ? [query.teamId] : [],
  });
  return toPaginatedDto(await repository.listHolidays(query), toHolidayDto);
}

async function listHolidayRange(query, authContext) {
  assertHolidayAccess(authContext, calendarReadPermissions, {
    appliedDepartmentIds: query.departmentId ? [query.departmentId] : [],
    appliedTeamIds: query.teamId ? [query.teamId] : [],
  });
  if (query.dateFrom > query.dateTo) throw validationError('dateFrom must be before or equal to dateTo');
  return { items: (await repository.listHolidayRange(query)).map(toHolidayDto) };
}

async function checkHoliday(query, authContext) {
  assertHolidayAccess(authContext, calendarReadPermissions, {
    appliedDepartmentIds: query.departmentId ? [query.departmentId] : [],
    appliedTeamIds: query.teamId ? [query.teamId] : [],
  });
  const holiday = await repository.findApplicable(query);
  return { dateKey: query.dateKey, holiday: toHolidayDto(holiday) };
}

async function summarizeHolidays(year, authContext) {
  assertHolidayAccess(authContext, calendarReadPermissions, { appliedDepartmentIds: [], appliedTeamIds: [] });
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
  assertHolidayAccess(authContext, calendarWritePermissions, current, { requireAll: true });
  const patch = normalizeHoliday({ ...current, ...payload, dateKey: payload.dateKey, date: payload.date }, current.dateKey);
  assertHolidayAccess(authContext, calendarWritePermissions, patch, { requireAll: true });
  await assertOrganizationScopes(patch);
  if (!hasHolidayChanges(current, patch)) return toHolidayDto(current);
  try {
    const updated = await repository.updateHoliday(id, patch);
    await recordCalendarAudit('HR_HOLIDAY_UPDATED', 'HR_HOLIDAY', updated, authContext, {
      metadata: {
        dateKey: updated.dateKey,
        holidayType: updated.holidayType,
        isWorkDay: Boolean(updated.isWorkDay),
      },
    });
    return toHolidayDto(updated);
  } catch (error) {
    throw duplicateError(error, 'Holiday already exists for this date');
  }
}

async function deleteHoliday(id, authContext) {
  const current = await repository.findHolidayById(id);
  if (!current) throw notFound('Holiday not found');
  assertHolidayAccess(authContext, calendarWritePermissions, current, { requireAll: true });
  const holiday = await repository.softDeleteHoliday(id);
  await recordCalendarAudit('HR_HOLIDAY_DELETED', 'HR_HOLIDAY', holiday, authContext, {
    metadata: { dateKey: holiday.dateKey, holidayType: holiday.holidayType },
  });
  return toHolidayDto(holiday);
}

async function bulkImportHolidays({ items }, authContext) {
  const normalized = items.map(normalizeHoliday);
  normalized.forEach((holiday) => assertHolidayAccess(authContext, calendarWritePermissions, holiday, { requireAll: true }));
  await Promise.all(normalized.map(assertOrganizationScopes));
  const imported = [];
  const duplicates = [];
  for (const holiday of normalized) {
    try {
      const created = await repository.createHoliday(holiday);
      imported.push(toHolidayDto(created));
      await recordCalendarAudit('HR_HOLIDAY_IMPORTED', 'HR_HOLIDAY', created, authContext, {
        source: 'IMPORT',
        metadata: {
          dateKey: created.dateKey,
          holidayType: created.holidayType,
          isWorkDay: Boolean(created.isWorkDay),
        },
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      duplicates.push({ dateKey: holiday.dateKey, reason: 'HOLIDAY_DATE_EXISTS' });
    }
  }
  return { imported: imported.length, skipped: duplicates.length, items: imported, duplicates };
}

function listHolidayTemplates() {
  const year = new Date().getFullYear();
  return { items: [
    {
      key: 'lunar-new-year', name: 'Tết Nguyên Đán', description: 'Tết Nguyên Đán (Tết dương lịch)',
      holiday: { name: 'Tết Nguyên Đán', isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Tết dương lịch - 3 ngày nghỉ' },
    },
    {
      key: 'lunar-new-year-ext', name: 'Tết Nguyên Đán (Mở rộng)', description: 'Tết Nguyên Đán + ngày thay (nếu có)',
      holiday: { name: 'Tết Nguyên Đán (Ngày thay)', isWorkDay: true, holidayType: 'SUBSTITUTE_WORK_DAY', note: 'Ngày thay cho Tết' },
    },
    {
      key: 'reunification-day', name: 'Ngày Quốc khánh (30/4)', description: 'Ngày Quốc khánh',
      holiday: { name: 'Ngày Quốc khánh', dateKey: `${year}-04-30`, isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Ngày Quốc khánh 30/4' },
    },
    {
      key: 'international-labor-day', name: 'Ngày Quốc tế Lao động (1/5)', description: 'Ngày Quốc tế Lao động',
      holiday: { name: 'Ngày Quốc tế Lao động', dateKey: `${year}-05-01`, isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Ngày Quốc tế Lao động 1/5' },
    },
    {
      key: 'national-day', name: 'Ngày Quốc khánh (2/9)', description: 'Ngày Quốc khánh Việt Nam',
      holiday: { name: 'Ngày Quốc khánh', dateKey: `${year}-09-02`, isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Ngày Quốc khánh 2/9' },
    },
    {
      key: 'mid-autumn', name: 'Tết Trung Thu', description: 'Tết Trung Thu (mùng 15 tháng 8 âm lịch)',
      holiday: { name: 'Tết Trung Thu', isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Tết Trung Thu' },
    },
  ] };
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

async function activeProfileIds(teamId) {
  return uniqueIds((await profileRepository.listIds({ teamId, status: 'ACTIVE' })).map(toId));
}

function isSaturday(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay() === 6;
}

function validateOffProfiles(profileIds, memberIds, maxOff) {
  const ids = uniqueIds(profileIds);
  if (ids.length !== (profileIds || []).length) throw validationError('Rotation employee profiles must be unique');
  if (ids.some((id) => !memberIds.includes(id))) throw validationError('Rotation employee must be an active team member');
  if (ids.length > maxOff) throw validationError('Rotation exceeds the maximum employees off');
  return ids;
}

async function getTeamContext(teamId, minPresent) {
  const members = await activeProfileIds(teamId);
  if (!members.length) throw validationError('Team has no active employee profiles');
  const requiredPresent = minPresent ?? Math.ceil(members.length / 2);
  if (requiredPresent > members.length) throw validationError('minPresent exceeds active team members');
  return { members, minPresent: requiredPresent, maxOff: members.length - requiredPresent };
}

async function generateRotations({ teamId, month, year, minPresent, customRotations = [] }, authContext) {
  assertTeamAccess(authContext, rotationWritePermissions, teamId);
  const { members, minPresent: requiredPresent, maxOff } = await getTeamContext(teamId, minPresent);
  const saturdays = saturdaysInMonth(year, month);
  const custom = new Map();
  for (const item of customRotations) {
    if (!saturdays.includes(item.dateKey)) throw validationError('Custom rotation date must be a Saturday in the requested month');
    if (custom.has(item.dateKey)) throw validationError('Custom rotation dates must be unique');
    custom.set(item.dateKey, validateOffProfiles(item.employeeProfileIds, members, maxOff));
  }

  const current = await repository.listRotations({ teamId, month, year, page: 1, limit: 100 });
  const currentByDate = new Map((current.items || []).map((rotation) => [rotation.workDateKey, rotation]));

  let cursor = 0;
  const items = [];
  for (const workDateKey of saturdays) {
    const existing = currentByDate.get(workDateKey);
    if (existing?.source === 'MANUAL' && !custom.has(workDateKey)) {
      items.push(toRotationDto(existing));
      continue;
    }
    let employeeProfileIds = custom.get(workDateKey);
    if (!employeeProfileIds) {
      employeeProfileIds = Array.from({ length: maxOff }, (_, offset) => members[(cursor + offset) % members.length]);
      cursor = (cursor + Math.max(maxOff, 1)) % members.length;
    }
    const rotation = await repository.upsertRotation({
      teamId,
      workDateKey,
      month,
      year,
      employeeProfileIds,
      minPresent: requiredPresent,
      source: custom.has(workDateKey) ? 'MANUAL' : 'GENERATED',
    });
    await recordCalendarAudit(
      'HR_SATURDAY_ROTATION_GENERATED',
      'HR_SATURDAY_ROTATION',
      rotation,
      authContext,
      { metadata: { teamId, workDateKey, month, year, offCount: employeeProfileIds.length } },
    );
    items.push(toRotationDto(rotation));
  }
  return { generated: items.length, items };
}

async function createRotation({ teamId, dateKey, employeeProfileIds, minPresent }, authContext) {
  assertTeamAccess(authContext, rotationWritePermissions, teamId);
  if (!isSaturday(dateKey)) throw validationError('Manual rotation date must be a Saturday');
  const context = await getTeamContext(teamId, minPresent);
  const rotation = await repository.upsertRotation({
    teamId,
    workDateKey: dateKey,
    month: new Date(`${dateKey}T00:00:00.000Z`).getUTCMonth() + 1,
    year: new Date(`${dateKey}T00:00:00.000Z`).getUTCFullYear(),
    employeeProfileIds: validateOffProfiles(employeeProfileIds, context.members, context.maxOff),
    minPresent: context.minPresent,
    source: 'MANUAL',
  });
  await recordCalendarAudit(
    'HR_SATURDAY_ROTATION_MANUAL_CREATED',
    'HR_SATURDAY_ROTATION',
    rotation,
    authContext,
    { metadata: { teamId, workDateKey: dateKey, offCount: employeeProfileIds.length } },
  );
  return toRotationDto(rotation);
}

async function listRotations(query, authContext) {
  if (!query.teamId && authContext && !hasGlobalPermission(authContext, rotationReadPermissions)) throw forbidden();
  if (query.teamId) assertTeamAccess(authContext, rotationReadPermissions, query.teamId);
  return toPaginatedDto(await repository.listRotations(query), toRotationDto);
}

async function listRotationMatrix(query, authContext) {
  if (!query.teamId && authContext && !hasGlobalPermission(authContext, rotationReadPermissions)) throw forbidden();
  if (query.teamId) assertTeamAccess(authContext, rotationReadPermissions, query.teamId);

  const rotations = await repository.listRotationsForMatrix(query);
  const dates = saturdaysInMonth(query.year, query.month);
  const teamIds = uniqueIds(rotations.map((rotation) => rotation.teamId));
  const teams = await Promise.all(teamIds.map(async (teamId) => {
    const teamMembers = await organizationPublic.listTeamMembers(teamId);
    const memberCount = (await activeProfileIds(teamId)).length;
    const rotationsByDate = new Map(
      rotations.filter((rotation) => String(rotation.teamId) === teamId).map((rotation) => [rotation.workDateKey, rotation]),
    );
    return {
      id: teamId,
      name: teamMembers.team?.name || 'Unnamed team',
      memberCount,
      cells: dates.map((dateKey) => {
        const rotation = rotationsByDate.get(dateKey);
        const offCount = rotation?.employeeProfileIds?.length || 0;
        return {
          dateKey,
          rotationId: rotation ? toId(rotation) : null,
          employeeProfileIds: rotation ? (rotation.employeeProfileIds || []).map(toId) : [],
          offCount,
          presentCount: memberCount - offCount,
          minPresent: rotation?.minPresent ?? null,
          source: rotation?.source || null,
        };
      }),
    };
  }));
  return { month: query.month, year: query.year, dates, teams };
}

async function updateRotation(id, { employeeProfileIds }, authContext) {
  const current = await repository.findRotationById(id);
  if (!current) throw notFound('Saturday rotation not found');
  assertTeamAccess(authContext, rotationWritePermissions, current.teamId);
  const { members, maxOff } = await getTeamContext(String(current.teamId), current.minPresent);
  const updated = await repository.updateRotation(id, {
    employeeProfileIds: validateOffProfiles(employeeProfileIds, members, maxOff),
    source: 'MANUAL',
  });
  await recordCalendarAudit(
    'HR_SATURDAY_ROTATION_UPDATED',
    'HR_SATURDAY_ROTATION',
    updated,
    authContext,
    { metadata: { teamId: toId(updated.teamId), workDateKey: updated.workDateKey, offCount: employeeProfileIds.length } },
  );
  return toRotationDto(updated);
}

async function deleteRotation(id, authContext) {
  const current = await repository.findRotationById(id);
  if (!current) throw notFound('Saturday rotation not found');
  assertTeamAccess(authContext, rotationWritePermissions, current.teamId);
  const rotation = await repository.deleteRotation(id);
  await recordCalendarAudit(
    'HR_SATURDAY_ROTATION_DELETED',
    'HR_SATURDAY_ROTATION',
    rotation,
    authContext,
    { metadata: { teamId: toId(rotation.teamId), workDateKey: rotation.workDateKey } },
  );
  return toRotationDto(rotation);
}

async function deleteTeamRotations(teamId, { month, year }, authContext) {
  assertTeamAccess(authContext, rotationWritePermissions, teamId);
  const existing = await repository.listRotations({ teamId, month, year, page: 1, limit: 100 });
  const result = await repository.deleteTeamRotations(teamId, month, year);
  if (result.deletedCount) {
    const operationKey = crypto.createHash('sha256')
      .update((existing.items || []).map(toId).sort().join(','))
      .digest('hex')
      .slice(0, 32);
    await recordCalendarAudit(
      'HR_SATURDAY_ROTATIONS_DELETED',
      'HR_SATURDAY_ROTATION_SET',
      { id: `${teamId}:${year}:${month}`, teamId },
      authContext,
      { metadata: { teamId, month, year, deletedCount: result.deletedCount }, operationKey },
    );
  }
  return { deleted: result.deletedCount || 0 };
}

module.exports = {
  bulkImportHolidays,
  checkHoliday,
  createRotation,
  createHoliday,
  deleteHoliday,
  deleteRotation,
  deleteTeamRotations,
  generateRotations,
  getHoliday,
  listHolidayRange,
  listHolidayTemplates,
  listHolidays,
  listRotationMatrix,
  listRotations,
  resolveCalendarPolicy,
  summarizeHolidays,
  updateHoliday,
  updateRotation,
};
