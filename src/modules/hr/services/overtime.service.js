const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const auditPublic = require('../../audit/public');
const notificationPublic = require('../../notification/public');
const organizationPublic = require('../../organization/public');
const {
  hrEmployeeStatuses,
  hrRequestStatuses,
  hrTimePermissions,
} = require('../constants/hr.constants');
const { toOvertimeRequestDto, toPaginatedOvertimeRequestsDto } = require('../dtos/overtime.dto');
const profileRepository = require('../repositories/employeeProfile.repository');
const repository = require('../repositories/overtime.repository');
const scheduleResolver = require('./scheduleResolver.service');

function appError(message, statusCode, code) {
  return new AppError(message, statusCode, true, code);
}

function conflict(message) {
  return appError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function invalid(message) {
  return appError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function minuteOfDay(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw invalid('Invalid overtime time');
  const [hour, minute] = value.split(':').map(Number);
  return (hour * 60) + minute;
}

function addDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedDateTimeToUtc(dateKey, time, timezone) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute),
    );
    const correction = target - represented;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

function resolveInterval(workDateKey, startTime, endTime, timezone) {
  const startMinute = minuteOfDay(startTime);
  let endMinute = minuteOfDay(endTime);
  if (endMinute <= startMinute) endMinute += 1440;
  const plannedStartAt = zonedDateTimeToUtc(workDateKey, startTime, timezone);
  const plannedEndAt = zonedDateTimeToUtc(
    endMinute >= 1440 ? addDateKey(workDateKey, 1) : workDateKey,
    endTime,
    timezone,
  );
  const requestedMinutes = (plannedEndAt.getTime() - plannedStartAt.getTime()) / 60000;
  if (requestedMinutes < 30 || requestedMinutes > 960) {
    throw invalid('Overtime duration must be between 30 and 960 minutes');
  }
  return { startMinute, endMinute, plannedStartAt, plannedEndAt, requestedMinutes };
}

function calendarClassFor(context) {
  if (context.status === 'HOLIDAY') return 'HOLIDAY';
  if (context.status === 'REST_DAY') return 'REST_DAY';
  return 'WORKDAY';
}

function scheduleSnapshot(context, profile) {
  return {
    assignmentId: toId(context.assignment),
    departmentId: toId(profile.departmentId),
    teamId: toId(profile.teamId),
    timezone: context.workLocation.timezone,
    calendarStatus: context.status,
    workLocation: {
      id: toId(context.workLocation),
      code: context.workLocation.code || null,
      name: context.workLocation.name || null,
    },
    shift: {
      id: toId(context.shift),
      code: context.shift.code || null,
      name: context.shift.name || null,
      startTime: context.shift.startTime,
      endTime: context.shift.endTime,
      breakMinutes: context.shift.breakMinutes ?? 0,
      graceMinutes: context.shift.graceMinutes ?? 0,
      durationMinutes: context.shift.durationMinutes,
      isOvernight: Boolean(context.shift.isOvernight),
    },
    calendarOverride: context.calendarOverride ? {
      id: toId(context.calendarOverride),
      kind: context.calendarOverride.kind || null,
      name: context.calendarOverride.name || null,
    } : null,
  };
}

async function getRequiredSelfProfile(authContext = {}) {
  if (!authContext.accountId) throw forbidden();
  const profile = await profileRepository.findByAccountId(authContext.accountId);
  if (
    !profile
    || profile.isDeleted
    || [hrEmployeeStatuses.RESIGNED, hrEmployeeStatuses.SUSPENDED].includes(profile.status)
  ) {
    throw notFound('Employee profile not found');
  }
  return profile;
}

async function actorSnapshot(authContext, reason = null) {
  if (!authContext?.accountId) throw forbidden();
  const profile = await profileRepository.findByAccountId(authContext.accountId);
  let actorName = toId(profile?.accountId) === String(authContext.accountId) ? profile.fullName : null;
  if (!actorName) {
    const account = await authPublic.getCurrentAccount(authContext.accountId);
    actorName = account?.profile?.fullName || account?.email || null;
  }
  return { actorId: authContext.accountId, actorName, reason, occurredAt: new Date() };
}

function hasGlobalPermission(authContext, permissions) {
  return permissions.some((permission) => (authContext.permissions || []).includes(permission));
}

function canAccessSnapshot(authContext, permission, snapshot) {
  if (hasGlobalPermission(authContext, [permission])) return true;
  return authPublic.canAccessScope(authContext, permission, {
    scopeType: 'team', scopeId: toId(snapshot?.teamId),
  }) || authPublic.canAccessScope(authContext, permission, {
    scopeType: 'department', scopeId: toId(snapshot?.departmentId),
  });
}

function assertCanApprove(request, authContext) {
  if (!canApproveRequest(request, authContext)) throw forbidden();
}

function assertRequester(request, authContext) {
  if (!isRequester(request, authContext)) throw forbidden();
}

function isRequester(request, authContext) {
  return String(request.requesterSnapshot?.accountId) === String(authContext.accountId);
}

function canApproveRequest(request, authContext) {
  return !isRequester(request, authContext)
    && canAccessSnapshot(authContext, hrTimePermissions.OVERTIME_APPROVE, request.requesterSnapshot);
}

function requestCapabilities(request, authContext) {
  const canApprove = request.status === hrRequestStatuses.PENDING && canApproveRequest(request, authContext);
  return {
    view: true,
    approve: canApprove,
    reject: canApprove,
    cancel: request.status === hrRequestStatuses.PENDING && isRequester(request, authContext),
  };
}

function canManageAttendance(authContext, profile) {
  return canAccessSnapshot(authContext, hrTimePermissions.ATTENDANCE_MANAGE, profile);
}

function scheduledShiftInterval(workDateKey, context) {
  if (!context.isWorkingDay || context.status !== 'WORKING_DAY') return false;
  const timezone = context.workLocation?.timezone;
  if (!timezone || !context.shift) return false;
  const plannedStartAt = zonedDateTimeToUtc(workDateKey, context.shift.startTime, timezone);
  const plannedEndAt = zonedDateTimeToUtc(
    context.shift.isOvernight ? addDateKey(workDateKey, 1) : workDateKey,
    context.shift.endTime,
    timezone,
  );
  return { plannedStartAt, plannedEndAt };
}

function overlapsScheduledShift(interval, workDateKey, context) {
  const shift = scheduledShiftInterval(workDateKey, context);
  return Boolean(shift)
    && interval.plannedStartAt < shift.plannedEndAt
    && interval.plannedEndAt > shift.plannedStartAt;
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

async function buildApprovalChain(profile) {
  if (!profile.teamId || typeof organizationPublic.listTeamMembers !== 'function') return [];
  const { leaders = [] } = await organizationPublic.listTeamMembers(toId(profile.teamId));
  const approver = leaders
    .filter((leader) => leader.accountId && String(leader.accountId) !== String(profile.accountId))
    .sort((left, right) => String(left.accountId).localeCompare(String(right.accountId)))[0];
  return approver ? [{ level: 1, approverAccountId: approver.accountId, status: 'PENDING' }] : [];
}

async function notifyOvertime(request) {
  const requestId = toId(request);
  const next = (request.approvalChain || [])
    .filter((step) => step.status === 'PENDING')
    .sort((left, right) => left.level - right.level)[0];
  const recipientAccountId = request.status === hrRequestStatuses.PENDING
    ? toId(next?.approverAccountId)
    : toId(request.requesterSnapshot?.accountId || request.accountId);
  if (!recipientAccountId) return;
  await notificationPublic.notify({
    recipientAccountId,
    type: `OVERTIME_${request.status}`,
    title: request.status === hrRequestStatuses.PENDING ? 'Overtime request awaiting approval' : `Overtime request ${request.status.toLowerCase()}`,
    message: `Overtime request ${requestId} is ${request.status.toLowerCase()}.`,
    relatedResource: { type: 'overtimeRequest', id: requestId },
    deduplicationKey: `overtime:${requestId}:${request.status}:${recipientAccountId}`,
  });
}

async function recordOvertimeAudit(request, actorAccountId) {
  if (request.status === hrRequestStatuses.PENDING) return;
  await auditPublic.record({
    actorAccountId,
    action: request.status,
    entityType: 'HR_OVERTIME_REQUEST',
    entityId: toId(request),
    metadata: { profileId: toId(request.profileId), approvedMinutes: request.approvedMinutes ?? null },
    deduplicationKey: `overtime:${toId(request)}:${request.status}`,
  });
}

async function createRequest(payload, authContext = {}) {
  const profile = await getRequiredSelfProfile(authContext);
  const context = await scheduleResolver.resolveWorkContext({
    profileId: toId(profile),
    workDateKey: payload.workDateKey,
  });
  if (context?.status === 'SCHEDULE_UNRESOLVED') {
    throw conflict('Effective work schedule is unavailable');
  }

  const interval = resolveInterval(
    payload.workDateKey,
    payload.plannedStartTime,
    payload.plannedEndTime,
    context.workLocation.timezone,
  );
  const adjacentDateKeys = [addDateKey(payload.workDateKey, -1), addDateKey(payload.workDateKey, 1)];
  const adjacentContexts = await Promise.all(adjacentDateKeys.map((workDateKey) => (
    scheduleResolver.resolveWorkContext({ profileId: toId(profile), workDateKey })
  )));
  const scheduledContexts = [
    [adjacentDateKeys[0], adjacentContexts[0]],
    [payload.workDateKey, context],
    [adjacentDateKeys[1], adjacentContexts[1]],
  ];
  if (
    scheduledContexts.some(([workDateKey, workContext]) => (
      overlapsScheduledShift(interval, workDateKey, workContext)
    ))
    && !canManageAttendance(authContext, profile)
  ) {
    throw forbidden();
  }
  if ((await repository.findOverlappingRequests(
    toId(profile), interval.plannedStartAt, interval.plannedEndAt,
  )).length) {
    throw conflict('Overtime request overlaps an existing request');
  }

  try {
    const created = await repository.createRequest({
      profileId: toId(profile),
      accountId: authContext.accountId,
      workDateKey: payload.workDateKey,
      plannedStartTime: payload.plannedStartTime,
      plannedEndTime: payload.plannedEndTime,
      ...interval,
      approvedMinutes: null,
      calendarClass: calendarClassFor(context),
      conflictMinuteKeys: Array.from(
        { length: interval.requestedMinutes },
        (_unused, index) => (interval.plannedStartAt.getTime() / 60000) + index,
      ),
      requesterSnapshot: {
        accountId: authContext.accountId,
        profileId: toId(profile),
        employeeCode: profile.employeeCode || null,
        fullName: profile.fullName,
        departmentId: toId(profile.departmentId),
        teamId: toId(profile.teamId),
      },
      scheduleSnapshot: scheduleSnapshot(context, profile),
      reason: payload.reason,
      status: hrRequestStatuses.PENDING,
      approvalChain: await buildApprovalChain(profile),
    });
    await notifyOvertime(created);
    return toOvertimeRequestDto(created);
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('Overtime request overlaps an existing request');
    throw error;
  }
}

function requestScopeFilters(authContext, permissions) {
  return (authContext.scopes || []).flatMap((scope) => {
    if (!permissions.some((permission) => (scope.permissions || []).includes(permission))) return [];
    if (scope.scopeType === 'team' && scope.scopeId) {
      return [{ 'requesterSnapshot.teamId': String(scope.scopeId) }];
    }
    if (scope.scopeType === 'department' && scope.scopeId) {
      return [{ 'requesterSnapshot.departmentId': String(scope.scopeId) }];
    }
    return [];
  });
}

async function requestPage(result, authContext) {
  const snapshots = (result.items || []).map((request) => request.requesterSnapshot || {});
  const departmentIds = [...new Set(snapshots.map((snapshot) => toId(snapshot.departmentId)).filter(Boolean))];
  const teamIds = [...new Set(snapshots.map((snapshot) => toId(snapshot.teamId)).filter(Boolean))];
  const [departments, teams] = await Promise.all([
    organizationPublic.listDepartmentsByIds(departmentIds),
    organizationPublic.listTeamsByIds(teamIds),
  ]);
  const departmentsById = new Map(departments.map((department) => [toId(department), department]));
  const teamsById = new Map(teams.map((team) => [toId(team), team]));
  const page = toPaginatedOvertimeRequestsDto(result, (request) => ({
    capabilities: requestCapabilities(request, authContext),
    requesterOrganization: {
      department: departmentsById.get(toId(request.requesterSnapshot?.departmentId)) || null,
      team: teamsById.get(toId(request.requesterSnapshot?.teamId)) || null,
    },
  }));
  return result.summary ? { ...page, summary: result.summary } : page;
}

async function listRequests(query = {}, authContext = {}) {
  if (query.own) {
    const profile = await getRequiredSelfProfile(authContext);
    const { own: _own, ...safeQuery } = query;
    const result = await repository.listRequests({
      ...safeQuery,
      profileId: toId(profile),
    });
    return requestPage(result, authContext);
  }
  const permissions = [hrTimePermissions.OVERTIME_READ, hrTimePermissions.OVERTIME_APPROVE];
  if (hasGlobalPermission(authContext, permissions)) {
    const result = await repository.listRequests(query);
    return requestPage(result, authContext);
  }
  const scopeFilters = requestScopeFilters(authContext, permissions);
  if (!scopeFilters.length) throw forbidden();
  const result = await repository.listRequests({ ...query, scopeFilters });
  return requestPage(result, authContext);
}

async function getRequestOrThrow(requestId) {
  const request = await repository.findRequestById(requestId);
  if (!request) throw notFound('Overtime request not found');
  return request;
}

function approvedMinutesFor(request, payload) {
  const minutes = payload.approvedMinutes ?? request.requestedMinutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > request.requestedMinutes) {
    throw invalid('approvedMinutes must be a positive integer not greater than requestedMinutes');
  }
  return minutes;
}

function currentApprovalStep(request) {
  return (request.approvalChain || [])
    .filter((step) => step.status === 'PENDING')
    .sort((left, right) => left.level - right.level)[0] || null;
}

function isGlobalApprover(authContext) {
  return hasGlobalPermission(authContext, [hrTimePermissions.OVERTIME_APPROVE]);
}

function assertCurrentApprover(request, authContext) {
  assertCanApprove(request, authContext);
  const step = currentApprovalStep(request);
  if (step?.approverAccountId
    && String(step.approverAccountId) !== String(authContext.accountId)
    && !isGlobalApprover(authContext)) {
    throw forbidden();
  }
}

function actedStepRetry(request, authContext) {
  return request.status === hrRequestStatuses.PENDING
    && (request.approvalChain || []).some((step) => (
      step.status === 'APPROVED' && String(step.actedByAccountId) === String(authContext.accountId)
    ));
}

async function approveRequest(requestId, payload = {}, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  assertCanApprove(request, authContext);
  if (actedStepRetry(request, authContext)) {
    await notifyOvertime(request);
    return toOvertimeRequestDto(request);
  }
  assertCurrentApprover(request, authContext);
  const approvedMinutes = approvedMinutesFor(request, payload);
  if (request.status === hrRequestStatuses.APPROVED) {
    if (request.approvedMinutes !== approvedMinutes) throw conflict('Overtime request was approved with different minutes');
    await notifyOvertime(request);
    await recordOvertimeAudit(request, authContext.accountId);
    return toOvertimeRequestDto(request);
  }
  if (request.status !== hrRequestStatuses.PENDING) throw conflict('Overtime request is already decided');
  const decision = await actorSnapshot(authContext, payload.reason || null);
  const step = currentApprovalStep(request);
  const approvalChain = (request.approvalChain || []).map((candidate) => (
    !step || candidate.level !== step.level ? candidate : {
      ...candidate,
      status: 'APPROVED',
      actedByAccountId: authContext.accountId,
      actedAt: new Date(),
      comment: payload.reason || null,
    }
  ));
  if (isGlobalApprover(authContext)) {
    approvalChain.forEach((candidate) => {
      if (candidate.status === 'PENDING') {
        candidate.status = 'APPROVED';
        candidate.actedByAccountId = authContext.accountId;
        candidate.actedAt = new Date();
      }
    });
  }
  const next = approvalChain.find((candidate) => candidate.status === 'PENDING');
  const transitionPatch = {
    status: next ? hrRequestStatuses.PENDING : hrRequestStatuses.APPROVED,
    approvedMinutes,
    approvalChain,
    currentApprovalLevel: next?.level || request.currentApprovalLevel || 1,
    decision: next ? null : decision,
  };
  let updated = (request.approvalChain || []).length
    ? await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, transitionPatch, {
      expectedApprovalLevel: request.currentApprovalLevel || 1,
    })
    : await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, transitionPatch);
  if (!updated) {
    updated = await getRequestOrThrow(requestId);
    assertCanApprove(updated, authContext);
    const isSameTerminalApproval = updated.status === hrRequestStatuses.APPROVED
      && updated.approvedMinutes === approvedMinutes;
    if (!isSameTerminalApproval && !actedStepRetry(updated, authContext)) {
      throw conflict('Overtime request changed before approval');
    }
  }
  await notifyOvertime(updated);
  await recordOvertimeAudit(updated, authContext.accountId);
  return toOvertimeRequestDto(updated);
}

async function rejectRequest(requestId, payload, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  assertCurrentApprover(request, authContext);
  if (request.status === hrRequestStatuses.REJECTED) {
    await notifyOvertime(request);
    await recordOvertimeAudit(request, authContext.accountId);
    return toOvertimeRequestDto(request);
  }
  if (request.status !== hrRequestStatuses.PENDING) throw conflict('Overtime request is already decided');
  const decision = await actorSnapshot(authContext, payload.reason);
  let updated = await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, {
    status: hrRequestStatuses.REJECTED,
    decision,
  });
  if (!updated) {
    updated = await getRequestOrThrow(requestId);
    assertCurrentApprover(updated, authContext);
    if (updated.status !== hrRequestStatuses.REJECTED) {
      throw conflict('Overtime request changed before rejection');
    }
  }
  await notifyOvertime(updated);
  await recordOvertimeAudit(updated, authContext.accountId);
  return toOvertimeRequestDto(updated);
}

async function cancelRequest(requestId, payload, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  if (request.status === hrRequestStatuses.CANCELLED) {
    if (!isRequester(request, authContext)) assertCanApprove(request, authContext);
    await notifyOvertime(request);
    await recordOvertimeAudit(request, authContext.accountId);
    return toOvertimeRequestDto(request);
  }
  if (request.status === hrRequestStatuses.APPROVED) assertCanApprove(request, authContext);
  else assertRequester(request, authContext);
  if (![hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED].includes(request.status)) {
    throw conflict('Overtime request cannot be cancelled');
  }
  const cancellation = await actorSnapshot(authContext, payload.reason);
  let updated = await repository.transitionRequest(requestId, request.status, {
    status: hrRequestStatuses.CANCELLED,
    cancellation,
  });
  if (!updated) {
    updated = await getRequestOrThrow(requestId);
    if (!isRequester(updated, authContext)) assertCanApprove(updated, authContext);
    if (updated.status !== hrRequestStatuses.CANCELLED) {
      throw conflict('Overtime request changed before cancellation');
    }
  }
  await notifyOvertime(updated);
  await recordOvertimeAudit(updated, authContext.accountId);
  return toOvertimeRequestDto(updated);
}

module.exports = { approveRequest, cancelRequest, createRequest, listRequests, rejectRequest };
