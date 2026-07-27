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

const calendarReadPermissions = ['HR_CALENDAR:READ', 'HR_CALENDAR:WRITE'];
const calendarWritePermissions = ['HR_CALENDAR:WRITE'];

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
    ...holiday.appliedDepartmentIds.map((id) => organizationPublic.getDepartmentById(id)),
    ...holiday.appliedTeamIds.map((id) => organizationPublic.getTeamById(id)),
  ]);
}

async function resolveCalendarPolicy({ profileId, workDateKey } = {}) {
  const schedule = await scheduleResolver.resolveWorkContext({ profileId, workDateKey });
  const scope = schedule.profile || {};
  const [holiday, isRotationOff] = await Promise.all([
    repository.findApplicable({ workDateKey, dateKey: workDateKey, ...scope }),
    scope.teamId ? repository.isRotationOff(profileId, workDateKey, scope.teamId) : false,
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
  assertHolidayAccess(authContext, calendarWritePermissions, holiday, { requireAll: true });
  await assertOrganizationScopes(holiday);
  try {
    return toHolidayDto(await repository.createHoliday(holiday));
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
  try {
    return toHolidayDto(await repository.updateHoliday(id, patch));
  } catch (error) {
    throw duplicateError(error, 'Holiday already exists for this date');
  }
}

async function deleteHoliday(id, authContext) {
  const current = await repository.findHolidayById(id);
  if (!current) throw notFound('Holiday not found');
  assertHolidayAccess(authContext, calendarWritePermissions, current, { requireAll: true });
  const holiday = await repository.softDeleteHoliday(id);
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
      imported.push(toHolidayDto(await repository.createHoliday(holiday)));
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
  const requiredPresent = minPresent ?? Math.ceil(members.length / 2);
  if (requiredPresent > members.length) throw validationError('minPresent exceeds active team members');
  return { members, minPresent: requiredPresent, maxOff: members.length - requiredPresent };
}

async function generateRotations({ teamId, month, year, minPresent, customRotations = [] }, authContext) {
  assertTeamAccess(authContext, calendarWritePermissions, teamId);
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
  if (!query.teamId && authContext && !hasGlobalPermission(authContext, calendarReadPermissions)) throw forbidden();
  if (query.teamId) assertTeamAccess(authContext, calendarReadPermissions, query.teamId);
  return toPaginatedDto(await repository.listRotations(query), toRotationDto);
}

async function updateRotation(id, { employeeProfileIds }, authContext) {
  const current = await repository.findRotationById(id);
  if (!current) throw notFound('Saturday rotation not found');
  assertTeamAccess(authContext, calendarWritePermissions, current.teamId);
  const { members, maxOff } = await getTeamContext(String(current.teamId), current.minPresent);
  const updated = await repository.updateRotation(id, {
    employeeProfileIds: validateOffProfiles(employeeProfileIds, members, maxOff),
  });
  return toRotationDto(updated);
}

async function deleteRotation(id, authContext) {
  const current = await repository.findRotationById(id);
  if (!current) throw notFound('Saturday rotation not found');
  assertTeamAccess(authContext, calendarWritePermissions, current.teamId);
  const rotation = await repository.deleteRotation(id);
  return toRotationDto(rotation);
}

async function deleteTeamRotations(teamId, { month, year }, authContext) {
  assertTeamAccess(authContext, calendarWritePermissions, teamId);
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
