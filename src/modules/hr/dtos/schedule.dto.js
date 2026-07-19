function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toActorDto(actor) {
  if (!actor) return null;
  return { accountId: toId(actor.accountId), fullName: actor.fullName || null };
}

function toWorkLocationDto(record) {
  if (!record) return null;
  return {
    id: toId(record),
    code: record.code || null,
    name: record.name || null,
    timezone: record.timezone || null,
    status: record.status || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function toShiftDto(record) {
  if (!record) return null;
  return {
    id: toId(record),
    code: record.code || null,
    name: record.name || null,
    workLocationId: toId(record.workLocationId),
    startTime: record.startTime || null,
    endTime: record.endTime || null,
    breakMinutes: record.breakMinutes ?? 0,
    graceMinutes: record.graceMinutes ?? 0,
    workdays: record.workdays || [],
    status: record.status || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function toAssignmentDto(record, {
  employee = null,
  shift = null,
  workLocation = null,
  capabilities,
} = {}) {
  if (!record) return null;
  return {
    id: toId(record),
    profileId: toId(record.profileId),
    shiftId: toId(record.shiftId),
    workLocationId: toId(record.workLocationId),
    employee,
    shift,
    workLocation,
    effectiveFrom: record.effectiveFrom || null,
    effectiveTo: record.effectiveTo || null,
    status: record.status || null,
    createdBy: toActorDto(record.createdBy),
    ...(capabilities ? { capabilities } : {}),
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function toCalendarOverrideDto(record, { scopeTarget = null, capabilities } = {}) {
  if (!record) return null;
  return {
    id: toId(record),
    dateKey: record.dateKey || null,
    kind: record.kind || null,
    scopeType: record.scopeType || null,
    scopeId: toId(record.scopeId),
    scopeTarget,
    name: record.name || null,
    status: record.status || null,
    createdBy: toActorDto(record.createdBy),
    ...(capabilities ? { capabilities } : {}),
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function toPaginatedDto(result, mapper) {
  return { items: (result.items || []).map(mapper), pagination: result.pagination };
}

module.exports = {
  toAssignmentDto,
  toCalendarOverrideDto,
  toPaginatedDto,
  toShiftDto,
  toWorkLocationDto,
};
