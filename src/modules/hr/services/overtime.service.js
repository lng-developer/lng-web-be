const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
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
  if (String(request.requesterSnapshot.accountId) === String(authContext.accountId)) throw forbidden();
  if (!canAccessSnapshot(authContext, hrTimePermissions.OVERTIME_APPROVE, request.requesterSnapshot)) {
    throw forbidden();
  }
}

function assertRequester(request, authContext) {
  if (String(request.requesterSnapshot.accountId) !== String(authContext.accountId)) throw forbidden();
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
    return toOvertimeRequestDto(await repository.createRequest({
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
    }));
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

async function listRequests(query = {}, authContext = {}) {
  if (query.own) {
    const profile = await getRequiredSelfProfile(authContext);
    const { own: _own, ...safeQuery } = query;
    return toPaginatedOvertimeRequestsDto(await repository.listRequests({
      ...safeQuery,
      profileId: toId(profile),
    }));
  }
  const permissions = [hrTimePermissions.OVERTIME_READ, hrTimePermissions.OVERTIME_APPROVE];
  if (hasGlobalPermission(authContext, permissions)) {
    return toPaginatedOvertimeRequestsDto(await repository.listRequests(query));
  }
  const scopeFilters = requestScopeFilters(authContext, permissions);
  if (!scopeFilters.length) throw forbidden();
  return toPaginatedOvertimeRequestsDto(await repository.listRequests({ ...query, scopeFilters }));
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

async function approveRequest(requestId, payload = {}, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  assertCanApprove(request, authContext);
  const approvedMinutes = approvedMinutesFor(request, payload);
  if (request.status === hrRequestStatuses.APPROVED) {
    if (request.approvedMinutes !== approvedMinutes) throw conflict('Overtime request was approved with different minutes');
    return toOvertimeRequestDto(request);
  }
  if (request.status !== hrRequestStatuses.PENDING) throw conflict('Overtime request is already decided');
  const decision = await actorSnapshot(authContext, payload.reason || null);
  const updated = await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, {
    status: hrRequestStatuses.APPROVED,
    approvedMinutes,
    decision,
  });
  if (!updated) throw conflict('Overtime request changed before approval');
  return toOvertimeRequestDto(updated);
}

async function rejectRequest(requestId, payload, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  assertCanApprove(request, authContext);
  if (request.status === hrRequestStatuses.REJECTED) return toOvertimeRequestDto(request);
  if (request.status !== hrRequestStatuses.PENDING) throw conflict('Overtime request is already decided');
  const decision = await actorSnapshot(authContext, payload.reason);
  const updated = await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, {
    status: hrRequestStatuses.REJECTED,
    decision,
  });
  if (!updated) throw conflict('Overtime request changed before rejection');
  return toOvertimeRequestDto(updated);
}

async function cancelRequest(requestId, payload, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  assertRequester(request, authContext);
  if (request.status === hrRequestStatuses.CANCELLED) return toOvertimeRequestDto(request);
  if (request.status !== hrRequestStatuses.PENDING) throw conflict('Overtime request cannot be cancelled');
  const cancellation = await actorSnapshot(authContext, payload.reason);
  const updated = await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, {
    status: hrRequestStatuses.CANCELLED,
    cancellation,
  });
  if (!updated) throw conflict('Overtime request changed before cancellation');
  return toOvertimeRequestDto(updated);
}

module.exports = { approveRequest, cancelRequest, createRequest, listRequests, rejectRequest };
