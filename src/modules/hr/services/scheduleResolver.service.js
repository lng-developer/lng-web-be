const { hrCalendarOverrideKinds, hrEmployeeStatuses } = require('../constants/hr.constants');
const profileRepository = require('../repositories/employeeProfile.repository');
const scheduleRepository = require('../repositories/schedule.repository');
const calendarPolicyRepository = require('../repositories/calendarPolicy.repository');
const { getShiftDurationMinutes } = require('../validators/schedule.validator');

const overridePriority = Object.freeze({
  GLOBAL: 0,
  WORK_LOCATION: 1,
  DEPARTMENT: 2,
  TEAM: 3,
  PROFILE: 4,
});

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function isActive(record) {
  return record && !record.isDeleted && record.status === hrEmployeeStatuses.ACTIVE;
}

function unresolved(profileId, workDateKey) {
  return { status: 'SCHEDULE_UNRESOLVED', profileId: toId(profileId), workDateKey };
}

function isValidWorkDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getIsoWeekday(workDateKey) {
  const day = new Date(`${workDateKey}T00:00:00.000Z`).getUTCDay();
  return day || 7;
}

function isValidTimezone(timezone) {
  if (typeof timezone !== 'string' || !timezone.trim()) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch (_error) {
    return false;
  }
}

function cached(cache, key, load) {
  if (!cache) return load();
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key);
}

function selectOverride(items = []) {
  return items.reduce((selected, item) => (
    !selected || overridePriority[item.scopeType] > overridePriority[selected.scopeType] ? item : selected
  ), null);
}

function toOverrideSnapshot(record) {
  if (!record) return null;
  return {
    id: toId(record),
    dateKey: record.dateKey || null,
    kind: record.kind || null,
    scopeType: record.scopeType || null,
    scopeId: toId(record.scopeId),
    name: record.name || null,
  };
}

function getCalendarDecision(override, shift, workDateKey) {
  if (override?.kind === hrCalendarOverrideKinds.HOLIDAY) return { status: 'HOLIDAY', isWorkingDay: false };
  if (override?.kind === hrCalendarOverrideKinds.REST_DAY) return { status: 'REST_DAY', isWorkingDay: false };
  if (override?.kind === hrCalendarOverrideKinds.WORKING_DAY) return { status: 'WORKING_DAY', isWorkingDay: true };
  const isWorkingDay = (shift.workdays || []).includes(getIsoWeekday(workDateKey));
  return { status: isWorkingDay ? 'WORKING_DAY' : 'REST_DAY', isWorkingDay };
}

function holidaySnapshot(holiday) {
  if (!holiday) return null;
  return {
    id: toId(holiday),
    dateKey: holiday.dateKey || null,
    name: holiday.name || null,
    holidayType: holiday.holidayType || null,
    isWorkDay: Boolean(holiday.isWorkDay),
    appliedDepartmentIds: (holiday.appliedDepartmentIds || []).map(toId),
    appliedTeamIds: (holiday.appliedTeamIds || []).map(toId),
    note: holiday.note || null,
  };
}

function toLocationSnapshot(location) {
  return {
    id: toId(location),
    code: location.code || null,
    name: location.name || null,
    timezone: location.timezone,
  };
}

function toShiftSnapshot(shift, durationMinutes) {
  const [startHour, startMinute] = shift.startTime.split(':').map(Number);
  const [endHour, endMinute] = shift.endTime.split(':').map(Number);
  return {
    id: toId(shift),
    code: shift.code || null,
    name: shift.name || null,
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakMinutes: shift.breakMinutes ?? 0,
    graceMinutes: shift.graceMinutes ?? 0,
    workdays: shift.workdays || [],
    durationMinutes,
    isOvernight: (endHour * 60) + endMinute <= (startHour * 60) + startMinute,
  };
}

function resolveContext({ profile, assignment, shift, workLocation, calendarOverrides = [], holiday, rotationOff, workDateKey }) {
  const durationMinutes = getShiftDurationMinutes(shift?.startTime, shift?.endTime);
  if (
    !isActive(assignment)
    || !isActive(shift)
    || !isActive(workLocation)
    || (shift.workLocationId && toId(shift.workLocationId) !== toId(assignment.workLocationId))
    || !isValidTimezone(workLocation.timezone)
    || durationMinutes === null
    || durationMinutes > 960
  ) {
    return unresolved(toId(profile), workDateKey);
  }
  const context = {
    profileId: toId(profile),
    workLocationId: toId(workLocation),
    departmentId: toId(profile.departmentId),
    teamId: toId(profile.teamId),
  };
  const calendarOverride = selectOverride(calendarOverrides);
  const decision = calendarOverride
    ? getCalendarDecision(calendarOverride, shift, workDateKey)
    : holiday
      ? { status: holiday.isWorkDay ? 'WORKING_DAY' : 'HOLIDAY', isWorkingDay: Boolean(holiday.isWorkDay) }
      : rotationOff
        ? { status: 'REST_DAY', isWorkingDay: false }
        : getCalendarDecision(null, shift, workDateKey);
  return {
    ...decision,
    profileId: toId(profile),
    workDateKey,
    profile: { departmentId: context.departmentId, teamId: context.teamId },
    assignment: {
      id: toId(assignment),
      effectiveFrom: assignment.effectiveFrom || null,
      effectiveTo: assignment.effectiveTo || null,
    },
    workLocation: toLocationSnapshot(workLocation),
    shift: toShiftSnapshot(shift, durationMinutes),
    calendarOverride: toOverrideSnapshot(calendarOverride),
    holiday: calendarOverride ? null : holidaySnapshot(holiday),
    isRotationOff: !calendarOverride && !holiday && Boolean(rotationOff),
  };
}

function matchesContext(override, context) {
  if (override.scopeType === 'GLOBAL') return !override.scopeId;
  const scopeKey = {
    WORK_LOCATION: 'workLocationId',
    DEPARTMENT: 'departmentId',
    TEAM: 'teamId',
    PROFILE: 'profileId',
  }[override.scopeType];
  return Boolean(scopeKey) && toId(override.scopeId) === context[scopeKey];
}

async function resolveWorkContext({ profileId, workDateKey } = {}, { cache } = {}) {
  if (!profileId || !isValidWorkDateKey(workDateKey)) return unresolved(profileId, workDateKey);

  const profile = await cached(cache, `profile:${profileId}`, () => profileRepository.findById(profileId));
  if (!isActive(profile)) return unresolved(profileId, workDateKey);

  const assignment = await scheduleRepository.findEffectiveAssignment(profileId, workDateKey);
  if (!isActive(assignment)) return unresolved(profileId, workDateKey);

  const [shift, workLocation] = await Promise.all([
    cached(cache, `shift:${assignment.shiftId}`, () => scheduleRepository.findShiftById(assignment.shiftId)),
    cached(cache, `workLocation:${assignment.workLocationId}`, () => scheduleRepository.findWorkLocationById(assignment.workLocationId)),
  ]);
  const durationMinutes = getShiftDurationMinutes(shift?.startTime, shift?.endTime);
  if (
    !isActive(shift)
    || !isActive(workLocation)
    || (shift.workLocationId && toId(shift.workLocationId) !== toId(assignment.workLocationId))
    || !isValidTimezone(workLocation.timezone)
    || durationMinutes === null
    || durationMinutes > 960
  ) {
    return unresolved(profileId, workDateKey);
  }
  const context = {
    profileId: toId(profile),
    workLocationId: toId(workLocation),
    departmentId: toId(profile.departmentId),
    teamId: toId(profile.teamId),
  };
  const [calendarOverrides, holiday, rotationOff] = await Promise.all([
    scheduleRepository.findCalendarOverrides(workDateKey, context),
    calendarPolicyRepository.findApplicable({ dateKey: workDateKey, ...context }),
    context.teamId
      ? calendarPolicyRepository.isRotationOff(profileId, workDateKey, context.teamId)
      : false,
  ]);
  return resolveContext({ profile, assignment, shift, workLocation, calendarOverrides, holiday, rotationOff, workDateKey });
}

async function resolveWorkContexts({ profileId, workDateKeys = [] } = {}) {
  const dateKeys = [...new Set(workDateKeys.filter(isValidWorkDateKey))];
  if (!profileId || !dateKeys.length) return dateKeys.map((workDateKey) => unresolved(profileId, workDateKey));
  const profile = await profileRepository.findById(profileId);
  if (!isActive(profile)) return dateKeys.map((workDateKey) => unresolved(profileId, workDateKey));

  const dateFrom = dateKeys[0];
  const dateTo = dateKeys.at(-1);
  const profileContext = {
    profileId: toId(profile),
    departmentId: toId(profile.departmentId),
    teamId: toId(profile.teamId),
  };
  const [assignments, holidays, rotations] = await Promise.all([
    scheduleRepository.listAssignmentsEffectiveForProfiles([profileId], dateFrom, dateTo),
    calendarPolicyRepository.listHolidayRange({ dateFrom, dateTo, departmentId: profileContext.departmentId, teamId: profileContext.teamId }),
    profileContext.teamId
      ? calendarPolicyRepository.listRotationsForProfileDates(profileId, profileContext.teamId, dateKeys)
      : [],
  ]);
  const activeAssignments = assignments.filter(isActive);
  const [shifts, workLocations] = await Promise.all([
    scheduleRepository.findShiftsByIds(activeAssignments.map((assignment) => assignment.shiftId)),
    scheduleRepository.findWorkLocationsByIds(activeAssignments.map((assignment) => assignment.workLocationId)),
  ]);
  const shiftsById = new Map(shifts.map((shift) => [toId(shift), shift]));
  const workLocationsById = new Map(workLocations.map((location) => [toId(location), location]));
  const contexts = activeAssignments.map((assignment) => ({
    ...profileContext,
    workLocationId: toId(assignment.workLocationId),
  }));
  const overrides = await scheduleRepository.findCalendarOverridesForDates(dateKeys, contexts);
  const overridesByDate = new Map();
  overrides.forEach((override) => {
    const items = overridesByDate.get(override.dateKey) || [];
    items.push(override);
    overridesByDate.set(override.dateKey, items);
  });
  const holidaysByDate = new Map(holidays.map((holiday) => [holiday.dateKey, holiday]));
  const rotationDates = new Set(rotations.map((rotation) => rotation.workDateKey));

  return dateKeys.map((workDateKey) => {
    const assignment = activeAssignments.find((item) => (
      item.effectiveFrom <= workDateKey && (!item.effectiveTo || item.effectiveTo >= workDateKey)
    ));
    if (!assignment) return unresolved(profileId, workDateKey);
    const shift = shiftsById.get(toId(assignment.shiftId));
    const workLocation = workLocationsById.get(toId(assignment.workLocationId));
    const context = { ...profileContext, workLocationId: toId(assignment.workLocationId) };
    const calendarOverrides = (overridesByDate.get(workDateKey) || [])
      .filter((override) => matchesContext(override, context));
    return resolveContext({
      profile,
      assignment,
      shift,
      workLocation,
      calendarOverrides,
      holiday: holidaysByDate.get(workDateKey) || null,
      rotationOff: rotationDates.has(workDateKey),
      workDateKey,
    });
  });
}

module.exports = { resolveWorkContext, resolveWorkContexts };
