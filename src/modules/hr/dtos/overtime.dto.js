function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toActorDto(actor) {
  if (!actor) return null;
  return {
    actorId: toId(actor.actorId),
    actorName: actor.actorName || null,
    reason: actor.reason || null,
    occurredAt: actor.occurredAt || null,
  };
}

function toScheduleSnapshotDto(snapshot) {
  if (!snapshot) return null;
  return {
    assignmentId: toId(snapshot.assignmentId),
    departmentId: toId(snapshot.departmentId),
    teamId: toId(snapshot.teamId),
    timezone: snapshot.timezone,
    calendarStatus: snapshot.calendarStatus,
    workLocation: snapshot.workLocation ? {
      id: toId(snapshot.workLocation.id),
      code: snapshot.workLocation.code || null,
      name: snapshot.workLocation.name || null,
    } : null,
    shift: snapshot.shift ? {
      id: toId(snapshot.shift.id),
      code: snapshot.shift.code || null,
      name: snapshot.shift.name || null,
      startTime: snapshot.shift.startTime,
      endTime: snapshot.shift.endTime,
      breakMinutes: snapshot.shift.breakMinutes ?? 0,
      graceMinutes: snapshot.shift.graceMinutes ?? 0,
      durationMinutes: snapshot.shift.durationMinutes,
      isOvernight: Boolean(snapshot.shift.isOvernight),
    } : null,
    calendarOverride: snapshot.calendarOverride ? {
      id: toId(snapshot.calendarOverride.id),
      kind: snapshot.calendarOverride.kind || null,
      name: snapshot.calendarOverride.name || null,
    } : null,
  };
}

function toEmployeeDto(request) {
  const requester = request.requesterSnapshot;
  if (!requester) return null;
  return {
    id: toId(requester.profileId) || toId(request.profileId),
    employeeCode: requester.employeeCode || null,
    fullName: requester.fullName || null,
  };
}

function toOvertimeRequestDto(request, { capabilities, requesterOrganization } = {}) {
  if (!request) return null;
  return {
    id: toId(request),
    employee: toEmployeeDto(request),
    profileId: toId(request.profileId),
    accountId: toId(request.accountId),
    workDateKey: request.workDateKey,
    plannedStartTime: request.plannedStartTime,
    plannedEndTime: request.plannedEndTime,
    requestedMinutes: request.requestedMinutes,
    approvedMinutes: request.approvedMinutes ?? null,
    approvedRateMinutes: request.approvedRateMinutes || null,
    calendarClass: request.calendarClass,
    requester: request.requesterSnapshot ? {
      accountId: toId(request.requesterSnapshot.accountId),
      profileId: toId(request.requesterSnapshot.profileId),
      employeeCode: request.requesterSnapshot.employeeCode || null,
      fullName: request.requesterSnapshot.fullName || null,
      departmentId: toId(request.requesterSnapshot.departmentId),
      teamId: toId(request.requesterSnapshot.teamId),
      department: requesterOrganization?.department || null,
      team: requesterOrganization?.team || null,
    } : null,
    scheduleSnapshot: toScheduleSnapshotDto(request.scheduleSnapshot),
    reason: request.reason,
    status: request.status,
    currentApprovalLevel: request.currentApprovalLevel ?? 1,
    approvalChain: (request.approvalChain || []).map((step) => ({
      level: step.level,
      approverAccountId: toId(step.approverAccountId),
      status: step.status,
      actedByAccountId: toId(step.actedByAccountId),
      actedAt: step.actedAt || null,
      comment: step.comment || null,
    })),
    decision: toActorDto(request.decision),
    cancellation: toActorDto(request.cancellation),
    ...(capabilities ? { capabilities } : {}),
    createdAt: request.createdAt || null,
    updatedAt: request.updatedAt || null,
  };
}

function toPaginatedOvertimeRequestsDto(result, optionsForItem) {
  return {
    items: (result.items || []).map((item) => toOvertimeRequestDto(
      item,
      typeof optionsForItem === 'function' ? optionsForItem(item) : optionsForItem,
    )),
    pagination: result.pagination,
  };
}

module.exports = { toOvertimeRequestDto, toPaginatedOvertimeRequestsDto };
