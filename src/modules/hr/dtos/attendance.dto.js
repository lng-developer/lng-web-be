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

function toAttendanceDto(record) {
  if (!record) return null;
  return {
    id: toId(record),
    profileId: toId(record.profileId),
    workDateKey: record.workDateKey || null,
    status: record.status || null,
    checkInAt: record.checkInAt || null,
    checkOutAt: record.checkOutAt || null,
    lateMinutes: record.lateMinutes ?? 0,
    earlyLeaveMinutes: record.earlyLeaveMinutes ?? 0,
    workedMinutes: record.workedMinutes ?? 0,
    source: record.source || null,
    scheduleSnapshot: record.scheduleSnapshot || null,
    leaveSegments: (record.leaveSegments || []).map((segment) => ({
      requestId: toId(segment.requestId),
      portion: segment.portion,
      units: segment.units,
      attendanceStatus: segment.attendanceStatus,
    })),
    manualAdjustments: (record.manualAdjustments || []).map(toAdjustmentDto),
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function toPaginatedAttendanceDto(result) {
  return {
    items: (result.items || []).map(toAttendanceDto),
    pagination: result.pagination,
  };
}

module.exports = { toAttendanceDto, toPaginatedAttendanceDto };
