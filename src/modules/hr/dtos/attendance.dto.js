function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toAdjustmentDto(adjustment) {
  return {
    actorId: toId(adjustment.actorId),
    actorName: adjustment.actorName || null,
    reason: adjustment.reason || null,
    adjustedAt: adjustment.adjustedAt || null,
    before: adjustment.before || null,
    after: adjustment.after || null,
  };
}

function toAttendanceDto(record, { employee = null, capabilities } = {}) {
  if (!record) return null;
  const scheduleSnapshot = record.scheduleSnapshot || null;
  return {
    id: toId(record),
    profileId: toId(record.profileId),
    employee,
    workDateKey: record.workDateKey || null,
    status: record.status || null,
    checkInAt: record.checkInAt || null,
    checkOutAt: record.checkOutAt || null,
    lateMinutes: record.lateMinutes ?? 0,
    earlyLeaveMinutes: record.earlyLeaveMinutes ?? 0,
    workedMinutes: record.workedMinutes ?? 0,
    source: record.source || null,
    shift: scheduleSnapshot?.shift || null,
    workLocation: scheduleSnapshot?.workLocation || null,
    scheduleSnapshot,
    leaveSegments: (record.leaveSegments || []).map((segment) => ({
      requestId: toId(segment.requestId),
      portion: segment.portion,
      units: segment.units,
      attendanceStatus: segment.attendanceStatus,
    })),
    manualAdjustments: (record.manualAdjustments || []).map(toAdjustmentDto),
    ...(capabilities ? { capabilities } : {}),
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function toPaginatedAttendanceDto(result, optionsForItem) {
  return {
    items: (result.items || []).map((item) => toAttendanceDto(
      item,
      typeof optionsForItem === 'function' ? optionsForItem(item) : optionsForItem,
    )),
    pagination: result.pagination,
  };
}

module.exports = { toAttendanceDto, toPaginatedAttendanceDto };
