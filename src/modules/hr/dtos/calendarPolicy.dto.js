function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toHolidayDto(holiday) {
  if (!holiday) return null;
  const isWorkDay = Boolean(holiday.isWorkDay);
  return {
    id: toId(holiday),
    name: holiday.name || null,
    dateKey: holiday.dateKey || null,
    holidayType: holiday.holidayType || null,
    isWorkDay,
    isPaid: holiday.holidayType === 'PUBLIC_HOLIDAY' && !isWorkDay,
    appliedDepartmentIds: (holiday.appliedDepartmentIds || []).map(toId),
    appliedTeamIds: (holiday.appliedTeamIds || []).map(toId),
    note: holiday.note || null,
    ...(holiday.isActive === undefined ? {} : { isActive: Boolean(holiday.isActive) }),
    ...(holiday.createdAt === undefined ? {} : { createdAt: holiday.createdAt }),
    ...(holiday.updatedAt === undefined ? {} : { updatedAt: holiday.updatedAt }),
  };
}

function toRotationDto(rotation) {
  if (!rotation) return null;
  return {
    id: toId(rotation),
    teamId: toId(rotation.teamId),
    dateKey: rotation.workDateKey || null,
    month: rotation.month ?? null,
    year: rotation.year ?? null,
    employeeProfileIds: (rotation.employeeProfileIds || []).map(toId),
    minPresent: rotation.minPresent ?? 0,
    source: rotation.source || 'GENERATED',
    ...(rotation.createdAt === undefined ? {} : { createdAt: rotation.createdAt }),
    ...(rotation.updatedAt === undefined ? {} : { updatedAt: rotation.updatedAt }),
  };
}

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

function toScheduleSnapshotDto(context) {
  if (!context) return null;
  return {
    status: context.status || null,
    profileId: toId(context.profileId),
    workDateKey: context.workDateKey || null,
    profile: context.profile ? {
      departmentId: toId(context.profile.departmentId),
      teamId: toId(context.profile.teamId),
    } : null,
    assignment: context.assignment ? {
      id: toId(context.assignment),
      effectiveFrom: context.assignment.effectiveFrom || null,
      effectiveTo: context.assignment.effectiveTo || null,
    } : null,
    workLocation: context.workLocation ? {
      id: toId(context.workLocation),
      ...pick(context.workLocation, ['code', 'name', 'timezone']),
    } : null,
    shift: context.shift ? {
      id: toId(context.shift),
      ...pick(context.shift, [
        'code', 'name', 'startTime', 'endTime', 'breakMinutes', 'graceMinutes', 'workdays', 'durationMinutes', 'isOvernight',
      ]),
    } : null,
    calendarOverride: context.calendarOverride ? {
      id: toId(context.calendarOverride),
      ...pick(context.calendarOverride, ['dateKey', 'kind', 'scopeType', 'scopeId', 'name']),
    } : null,
    isWorkingDay: Boolean(context.isWorkingDay),
  };
}

function toPaginatedDto(result, mapper) {
  return { items: (result.items || []).map(mapper), pagination: result.pagination };
}

module.exports = {
  toHolidayDto,
  toPaginatedDto,
  toRotationDto,
  toScheduleSnapshotDto,
};
