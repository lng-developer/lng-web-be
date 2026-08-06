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

async function resolveWorkContext({ profileId, workDateKey } = {}) {
  if (!profileId || !isValidWorkDateKey(workDateKey)) return unresolved(profileId, workDateKey);

  const profile = await profileRepository.findById(profileId);
  if (!isActive(profile)) return unresolved(profileId, workDateKey);

  const assignment = await scheduleRepository.findEffectiveAssignment(profileId, workDateKey);
  if (!isActive(assignment)) return unresolved(profileId, workDateKey);

  const [shift, workLocation] = await Promise.all([
    scheduleRepository.findShiftById(assignment.shiftId),
    scheduleRepository.findWorkLocationById(assignment.workLocationId),
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

module.exports = { resolveWorkContext };
