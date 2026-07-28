const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const auditPublic = require('../../audit/public');
const notificationPublic = require('../../notification/public');
const organizationPublic = require('../../organization/public');
const {
  hrAttendanceStatuses,
  hrEmployeeStatuses,
  hrRequestStatuses,
  hrTimePermissions,
} = require('../constants/hr.constants');
const {
  toLeaveBalanceDto,
  toLeaveRequestDto,
  toPaginatedLeaveRequestsDto,
} = require('../dtos/leave.dto');
const profileRepository = require('../repositories/employeeProfile.repository');
const repository = require('../repositories/leave.repository');
const attendanceService = require('./attendance.service');
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

function addDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRange(startDateKey, endDateKey) {
  if (endDateKey < startDateKey) throw invalid('endDateKey must not be before startDateKey');
  if (startDateKey.slice(0, 4) !== endDateKey.slice(0, 4)) {
    throw invalid('A leave request must stay within one balance year');
  }
  const dates = [];
  for (let dateKey = startDateKey; dateKey <= endDateKey; dateKey = addDateKey(dateKey, 1)) {
    dates.push(dateKey);
    if (dates.length > 366) throw invalid('Leave request range is too large');
  }
  return dates;
}

function attendanceStatusForLeaveType(leaveType) {
  return ['UNPAID', 'PERSONAL_UNPAID'].includes(leaveType)
    ? hrAttendanceStatuses.UNPAID_LEAVE
    : hrAttendanceStatuses.PAID_LEAVE;
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
    actorName = account?.account?.email || null;
  }
  return {
    actorId: authContext.accountId,
    actorName,
    reason,
    occurredAt: new Date(),
  };
}

function hasGlobalPermission(authContext, permissions) {
  return permissions.some((permission) => (authContext.permissions || []).includes(permission));
}

function canAccessSnapshot(authContext, permission, snapshot) {
  if (hasGlobalPermission(authContext, [permission])) return true;
  return authPublic.canAccessScope(authContext, permission, {
    scopeType: 'team',
    scopeId: toId(snapshot?.teamId),
  }) || authPublic.canAccessScope(authContext, permission, {
    scopeType: 'department',
    scopeId: toId(snapshot?.departmentId),
  });
}

function assertCanApprove(request, authContext) {
  if (!canApproveRequest(request, authContext)) throw forbidden();
}

function assertCanCancel(request, authContext) {
  if (!canCancelRequestAccess(request, authContext)) throw forbidden();
}

function isRequester(request, authContext) {
  return String(request.requesterSnapshot?.accountId) === String(authContext.accountId);
}

function canApproveRequest(request, authContext) {
  return !isRequester(request, authContext)
    && canAccessSnapshot(authContext, hrTimePermissions.LEAVE_APPROVE, request.requesterSnapshot);
}

function canCancelRequestAccess(request, authContext) {
  return isRequester(request, authContext) || canApproveRequest(request, authContext);
}

function requestCapabilities(request, authContext) {
  const canApprove = request.status === hrRequestStatuses.PENDING && canApproveRequest(request, authContext);
  let canCancel = request.status === hrRequestStatuses.PENDING && isRequester(request, authContext);
  if (request.status === hrRequestStatuses.APPROVED && canApproveRequest(request, authContext)) {
    const firstDate = request.workingDateSnapshots?.[0];
    canCancel = Boolean(firstDate?.scheduleSnapshot?.timezone)
      && localDateKey(new Date(), firstDate.scheduleSnapshot.timezone) < firstDate.dateKey;
  }
  return { view: true, approve: canApprove, reject: canApprove, cancel: canCancel };
}

function conflictKeysFor(workingDateKeys, portion) {
  const portions = portion === 'FULL_DAY' ? ['MORNING', 'AFTERNOON'] : [portion];
  return workingDateKeys.flatMap((dateKey) => portions.map((part) => `${dateKey}:${part}`));
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

async function prepareRequest(payload, authContext = {}) {
  const profile = await getRequiredSelfProfile(authContext);
  if (payload.portion !== 'FULL_DAY' && payload.startDateKey !== payload.endDateKey) {
    throw invalid('A half-day request must use one work date');
  }

  const allDateKeys = dateRange(payload.startDateKey, payload.endDateKey);
  const contexts = await Promise.all(allDateKeys.map(async (workDateKey) => ({
    workDateKey,
    context: await scheduleResolver.resolveWorkContext({ profileId: toId(profile), workDateKey }),
  })));
  const workingDateSnapshots = [];
  for (const { workDateKey, context } of contexts) {
    if (context?.status === 'SCHEDULE_UNRESOLVED') {
      throw conflict(`Effective work schedule is unavailable for ${workDateKey}`);
    }
    if (!context?.isWorkingDay || context.status !== 'WORKING_DAY') continue;
    workingDateSnapshots.push({
      dateKey: workDateKey,
      units: payload.portion === 'FULL_DAY' ? 2 : 1,
      scheduleSnapshot: scheduleSnapshot(context, profile),
    });
  }
  if (!workingDateSnapshots.length) throw conflict('Leave range contains no working date');

  const workingDateKeys = workingDateSnapshots.map(({ dateKey }) => dateKey);
  const conflictKeys = conflictKeysFor(workingDateKeys, payload.portion);
  const overlaps = await repository.findOverlappingRequests(toId(profile), conflictKeys);
  const requestedUnits = workingDateSnapshots.reduce((total, entry) => total + entry.units, 0);
  return {
    profile,
    overlaps,
    draft: {
      profileId: toId(profile),
      accountId: authContext.accountId,
      year: Number(payload.startDateKey.slice(0, 4)),
      leaveType: payload.leaveType,
      attendanceStatus: attendanceStatusForLeaveType(payload.leaveType),
      portion: payload.portion,
      startDateKey: payload.startDateKey,
      endDateKey: payload.endDateKey,
      workingDateKeys,
      conflictKeys,
      workingDateSnapshots,
      requestedUnits,
      requesterSnapshot: {
        accountId: authContext.accountId,
        profileId: toId(profile),
        employeeCode: profile.employeeCode || null,
        fullName: profile.fullName,
        departmentId: toId(profile.departmentId),
        teamId: toId(profile.teamId),
      },
      reason: payload.reason,
      attachments: payload.attachments || [],
      status: hrRequestStatuses.PENDING,
    },
  };
}

async function previewRequest(payload, authContext = {}) {
  const { draft, overlaps } = await prepareRequest(payload, authContext);
  const balance = draft.leaveType === 'ANNUAL'
    ? await repository.findBalance(draft.profileId, draft.year, draft.leaveType)
    : null;
  const availableUnits = balance
    ? (balance.entitledUnits || 0) + (balance.carriedOverUnits || 0)
      + (balance.adjustmentUnits || 0) - (balance.usedUnits || 0)
    : null;
  return {
    requestedUnits: draft.requestedUnits,
    workingDateKeys: draft.workingDateKeys,
    conflictCount: overlaps.length,
    availableUnits,
    isPossible: !overlaps.length && (availableUnits === null || availableUnits >= draft.requestedUnits),
  };
}

async function notifyLeaveAction(request, action = request.status) {
  const requestId = toId(request);
  const next = (request.approvalChain || [])
    .filter((step) => step.status === 'PENDING')
    .sort((left, right) => left.level - right.level)[0];
  const recipientAccountId = action === hrRequestStatuses.PENDING
    ? toId(next?.approverAccountId)
    : toId(request.requesterSnapshot?.accountId || request.accountId);
  if (!recipientAccountId) return;
  await notificationPublic.notify({
    recipientAccountId,
    type: `LEAVE_${action}`,
    title: action === hrRequestStatuses.PENDING ? 'Leave request awaiting approval' : `Leave request ${action.toLowerCase()}`,
    message: `Leave request ${requestId} is ${action.toLowerCase()}.`,
    relatedResource: { type: 'leaveRequest', id: requestId },
    deduplicationKey: `leave:${requestId}:${action}:${recipientAccountId}`,
  });
}

async function notifyLeave(request) {
  return notifyLeaveAction(request, request.status);
}

async function recordLeaveAudit(request, actorId, action = request.status, operationKey = null) {
  if (action === hrRequestStatuses.PENDING) return;
  await auditPublic.record({
    actorAccountId: actorId,
    action,
    entityType: 'HR_LEAVE_REQUEST',
    entityId: toId(request),
    metadata: { profileId: toId(request.profileId), leaveType: request.leaveType },
    deduplicationKey: `leave:${toId(request)}:${action}${operationKey ? `:${operationKey}` : ''}`,
  });
}

async function createRequest(payload, authContext = {}) {
  const { draft, overlaps, profile } = await prepareRequest(payload, authContext);
  if (overlaps.length) throw conflict('Leave request overlaps an existing request');
  draft.approvalChain = await buildApprovalChain(profile);
  try {
    const created = await repository.createRequest(draft);
    await notifyLeave(created);
    return toLeaveRequestDto(created);
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('Leave request overlaps an existing request');
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
  const page = toPaginatedLeaveRequestsDto(result, (request) => ({
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

  const permissions = [hrTimePermissions.LEAVE_READ, hrTimePermissions.LEAVE_APPROVE];
  if (hasGlobalPermission(authContext, permissions)) {
    const result = await repository.listRequests(query);
    return requestPage(result, authContext);
  }
  const scopeFilters = requestScopeFilters(authContext, permissions);
  if (!scopeFilters.length) throw forbidden();
  const result = await repository.listRequests({ ...query, scopeFilters });
  return requestPage(result, authContext);
}

async function getMyBalances(year, authContext = {}) {
  const profile = await getRequiredSelfProfile(authContext);
  const balances = await repository.listBalances({ profileId: toId(profile), year });
  return balances.map(toLeaveBalanceDto);
}

function canReadProfile(authContext, profile) {
  const permissions = [hrTimePermissions.LEAVE_READ, hrTimePermissions.LEAVE_APPROVE];
  if (hasGlobalPermission(authContext, permissions)) return true;
  return permissions.some((permission) => canAccessSnapshot(authContext, permission, profile));
}

async function getBalance(profileId, year, leaveType, authContext = {}) {
  const profile = await profileRepository.findById(profileId);
  if (!profile || profile.isDeleted) throw notFound('Employee profile not found');
  if (!canReadProfile(authContext, profile)) throw forbidden();
  return toLeaveBalanceDto(await repository.findBalance(profileId, year, leaveType));
}

async function upsertBalance(profileId, year, leaveType, payload, authContext = {}) {
  const profile = await profileRepository.findById(profileId);
  if (!profile || profile.isDeleted) throw notFound('Employee profile not found');
  if (!canAccessSnapshot(authContext, hrTimePermissions.LEAVE_APPROVE, profile)) throw forbidden();
  const actor = await actorSnapshot(authContext, payload.reason);
  return toLeaveBalanceDto(await repository.upsertBalance(
    profileId,
    year,
    leaveType,
    { entitledUnits: payload.entitledUnits, adjustmentUnits: payload.adjustmentUnits },
    {
      ...actor,
      action: 'SET',
      units: 0,
      entitledUnits: payload.entitledUnits,
      adjustmentUnits: payload.adjustmentUnits,
    },
  ));
}

async function runTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

async function getRequestOrThrow(requestId, options) {
  const request = await repository.findRequestById(requestId, options);
  if (!request) throw notFound('Leave request not found');
  return request;
}

async function assertCanManageBalance(profileId, authContext) {
  const profile = await profileRepository.findById(profileId);
  if (!profile || profile.isDeleted) throw notFound('Employee profile not found');
  if (!canAccessSnapshot(authContext, hrTimePermissions.LEAVE_APPROVE, profile)) throw forbidden();
  return profile;
}

async function adjustBalance(profileId, year, leaveType, payload, authContext = {}) {
  await assertCanManageBalance(profileId, authContext);
  const actor = await actorSnapshot(authContext, payload.reason);
  const balance = await repository.adjustBalance(profileId, year, leaveType, payload.units, {
    ...actor,
    action: 'ADJUST',
    units: Math.abs(payload.units),
  });
  if (!balance) throw conflict('Leave balance adjustment would make available units negative');
  return toLeaveBalanceDto(balance);
}

async function targetProfileIds(profileIds = []) {
  if (profileIds.length) return [...new Set(profileIds.map(String))];
  return (await profileRepository.listIds({ status: hrEmployeeStatuses.ACTIVE })).map(toId);
}

async function accrueBalances(payload, authContext = {}) {
  const profileIds = await targetProfileIds(payload.profileIds);
  const items = [];
  for (const profileId of profileIds) {
    await assertCanManageBalance(profileId, authContext);
    const actor = await actorSnapshot(authContext, payload.reason);
    await repository.ensureBalance(profileId, payload.year, 'ANNUAL');
    const updated = await repository.accrueBalance(
      profileId,
      payload.year,
      'ANNUAL',
      payload.month,
      payload.units,
      { ...actor, action: 'ACCRUE', units: payload.units },
    );
    if (updated) items.push(toLeaveBalanceDto(updated));
  }
  return { items, processed: profileIds.length, changed: items.length };
}

async function resetBalances(payload, authContext = {}) {
  const profileIds = await targetProfileIds(payload.profileIds);
  const items = [];
  for (const profileId of profileIds) {
    await assertCanManageBalance(profileId, authContext);
    const actor = await actorSnapshot(authContext, payload.reason);
    items.push(toLeaveBalanceDto(await repository.resetBalance(
      profileId,
      payload.year,
      payload.leaveType,
      payload.entitledUnits,
      { ...actor, action: 'RESET', units: payload.entitledUnits },
    )));
  }
  return { items, processed: items.length };
}

async function carryOverBalances(payload, authContext = {}) {
  if (payload.toYear !== payload.fromYear + 1) throw invalid('toYear must follow fromYear');
  const profileIds = await targetProfileIds(payload.profileIds);
  const items = [];
  for (const profileId of profileIds) {
    await assertCanManageBalance(profileId, authContext);
    const previous = await repository.findBalance(profileId, payload.fromYear, payload.leaveType);
    if (!previous) continue;
    const available = Math.max(0, (previous.entitledUnits || 0) + (previous.carriedOverUnits || 0)
      + (previous.adjustmentUnits || 0) - (previous.usedUnits || 0));
    const units = Math.min(available, payload.maxUnits);
    const current = await repository.findBalance(profileId, payload.toYear, payload.leaveType);
    if (current?.carriedOverUnits === units) {
      items.push(toLeaveBalanceDto(current));
      continue;
    }
    const actor = await actorSnapshot(authContext, payload.reason);
    items.push(toLeaveBalanceDto(await repository.setCarryOver(
      profileId,
      payload.toYear,
      payload.leaveType,
      units,
      { ...actor, action: 'CARRY_OVER', units },
    )));
  }
  return { items, processed: items.length };
}

async function attachReferences(requestId, payload, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  if (!isRequester(request, authContext)) throw forbidden();
  const updated = await repository.appendAttachments(requestId, authContext.accountId, payload.attachments);
  if (!updated) throw conflict('Attachments can only be added to a pending request');
  return toLeaveRequestDto(updated);
}

function currentApprovalStep(request) {
  return (request.approvalChain || [])
    .filter((step) => step.status === 'PENDING')
    .sort((left, right) => left.level - right.level)[0] || null;
}

function isGlobalApprover(authContext) {
  return hasGlobalPermission(authContext, [hrTimePermissions.LEAVE_APPROVE]);
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

async function approveRequest(requestId, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  assertCanApprove(request, authContext);
  if (actedStepRetry(request, authContext)) {
    await notifyLeave(request);
    return toLeaveRequestDto(request);
  }
  assertCurrentApprover(request, authContext);
  if (![hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED].includes(request.status)) {
    throw conflict('Leave request is already decided');
  }
  const decision = request.status === hrRequestStatuses.PENDING
    ? await actorSnapshot(authContext)
    : null;

  const approved = await runTransaction(async (session) => {
    const current = await getRequestOrThrow(requestId, { session });
    assertCanApprove(current, authContext);
    if (actedStepRetry(current, authContext)) return current;
    assertCurrentApprover(current, authContext);
    if (current.status === hrRequestStatuses.APPROVED) {
      await attendanceService.reconcileApprovedLeave(current, { session });
      return current;
    }
    if (current.status !== hrRequestStatuses.PENDING) {
      throw conflict('Leave request is already decided');
    }

    const step = currentApprovalStep(current);
    const approvalChain = (current.approvalChain || []).map((candidate) => (
      !step || candidate.level !== step.level ? candidate : {
        ...candidate,
        status: 'APPROVED',
        actedByAccountId: authContext.accountId,
        actedAt: new Date(),
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
    if (next) {
      const updated = await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, {
        approvalChain,
        currentApprovalLevel: next.level,
      }, {
        session,
        ...((current.approvalChain || []).length ? { expectedApprovalLevel: current.currentApprovalLevel || 1 } : {}),
      });
      if (!updated) throw conflict('Leave request changed before approval');
      return updated;
    }

    await attendanceService.reconcileApprovedLeave(current, { session });
    const history = {
      ...decision,
      requestId,
      action: 'CONSUME',
      units: current.requestedUnits,
      reason: 'Leave request approved',
    };
    if (current.leaveType === 'ANNUAL') {
      const consumed = await repository.consumeBalanceUnits(
        toId(current.profileId),
        current.year,
        current.leaveType,
        current.requestedUnits,
        history,
        { session },
      );
      if (consumed.modifiedCount !== 1) throw conflict('Insufficient leave balance');
    }

    const updated = await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, {
      status: hrRequestStatuses.APPROVED,
      approvalChain,
      decision,
    }, {
      session,
      ...((current.approvalChain || []).length ? { expectedApprovalLevel: current.currentApprovalLevel || 1 } : {}),
    });
    if (!updated) throw conflict('Leave request changed before approval');
    return updated;
  });
  await notifyLeave(approved);
  await recordLeaveAudit(approved, authContext.accountId);
  return toLeaveRequestDto(approved);
}

async function rejectRequest(requestId, payload, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  assertCurrentApprover(request, authContext);
  if (request.status === hrRequestStatuses.REJECTED) {
    await notifyLeave(request);
    await recordLeaveAudit(request, authContext.accountId);
    return toLeaveRequestDto(request);
  }
  if (request.status !== hrRequestStatuses.PENDING) throw conflict('Leave request is already decided');
  const decision = await actorSnapshot(authContext, payload.reason);
  let rejected = await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, {
    status: hrRequestStatuses.REJECTED,
    decision,
  });
  if (!rejected) {
    rejected = await getRequestOrThrow(requestId);
    assertCurrentApprover(rejected, authContext);
    if (rejected.status !== hrRequestStatuses.REJECTED) {
      throw conflict('Leave request changed before rejection');
    }
  }
  await notifyLeave(rejected);
  await recordLeaveAudit(rejected, authContext.accountId);
  return toLeaveRequestDto(rejected);
}

function localDateKey(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function refundRequest(requestId, payload, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  assertCanApprove(request, authContext);
  if (request.status !== hrRequestStatuses.APPROVED) throw conflict('Only approved leave can be refunded');
  if (request.leaveType !== 'ANNUAL') throw conflict('Only annual leave can be refunded');
  const requestedDateKeys = [...new Set(payload.dateKeys)];
  const auditOperationKey = [...requestedDateKeys].sort().join(',');
  if (requestedDateKeys.every((dateKey) => (request.refundedDateKeys || []).includes(dateKey))) {
    await notifyLeaveAction(request, 'REFUNDED');
    await recordLeaveAudit(request, authContext.accountId, 'REFUNDED', auditOperationKey);
    return toLeaveRequestDto(request);
  }

  const refunded = await runTransaction(async (session) => {
    const current = await getRequestOrThrow(requestId, { session });
    assertCanApprove(current, authContext);
    if (requestedDateKeys.every((dateKey) => (current.refundedDateKeys || []).includes(dateKey))) return current;
    const selected = (current.workingDateSnapshots || [])
      .filter((snapshot) => requestedDateKeys.includes(snapshot.dateKey));
    if (selected.length !== requestedDateKeys.length) throw invalid('Refund dates must belong to the active leave request');
    const remaining = (current.workingDateSnapshots || [])
      .filter((snapshot) => !requestedDateKeys.includes(snapshot.dateKey));
    if (!remaining.length) throw invalid('Use cancellation to refund the entire leave request');
    const units = selected.reduce((total, snapshot) => total + snapshot.units, 0);
    const actor = await actorSnapshot(authContext, payload.reason);

    await attendanceService.reverseApprovedLeave(toId(current.profileId), requestId, { session });
    await attendanceService.reconcileApprovedLeave({ ...current, workingDateSnapshots: remaining }, { session });
    const balance = await repository.refundBalanceUnits(
      toId(current.profileId),
      current.year,
      current.leaveType,
      units,
      { ...actor, requestId, action: 'REFUND', units },
      { session },
    );
    if (balance.modifiedCount !== 1) throw conflict('Leave balance cannot be refunded');
    const workingDateKeys = remaining.map((snapshot) => snapshot.dateKey);
    const updated = await repository.transitionRequest(requestId, hrRequestStatuses.APPROVED, {
      startDateKey: workingDateKeys[0],
      endDateKey: workingDateKeys[workingDateKeys.length - 1],
      workingDateSnapshots: remaining,
      workingDateKeys,
      conflictKeys: conflictKeysFor(workingDateKeys, current.portion),
      requestedUnits: current.requestedUnits - units,
      refundedDateKeys: [...new Set([...(current.refundedDateKeys || []), ...requestedDateKeys])],
      refunds: [...(current.refunds || []), {
        dateKeys: requestedDateKeys,
        units,
        reason: payload.reason,
        actorId: authContext.accountId,
        occurredAt: actor.occurredAt,
      }],
    }, { session });
    if (!updated) throw conflict('Leave request changed before refund');
    return updated;
  });
  await notifyLeaveAction(refunded, 'REFUNDED');
  await recordLeaveAudit(refunded, authContext.accountId, 'REFUNDED', auditOperationKey);
  return toLeaveRequestDto(refunded);
}

async function cancelRequest(requestId, payload, authContext = {}) {
  const request = await getRequestOrThrow(requestId);
  assertCanCancel(request, authContext);
  if (request.status === hrRequestStatuses.CANCELLED) {
    await notifyLeave(request);
    await recordLeaveAudit(request, authContext.accountId);
    return toLeaveRequestDto(request);
  }
  const cancellation = await actorSnapshot(authContext, payload.reason);

  if (request.status === hrRequestStatuses.PENDING) {
    if (String(request.requesterSnapshot.accountId) !== String(authContext.accountId)) throw forbidden();
    let cancelled = await repository.transitionRequest(requestId, hrRequestStatuses.PENDING, {
      status: hrRequestStatuses.CANCELLED,
      cancellation,
    });
    if (!cancelled) {
      cancelled = await getRequestOrThrow(requestId);
      assertCanCancel(cancelled, authContext);
      if (cancelled.status !== hrRequestStatuses.CANCELLED) {
        throw conflict('Leave request changed before cancellation');
      }
    }
    await notifyLeave(cancelled);
    await recordLeaveAudit(cancelled, authContext.accountId);
    return toLeaveRequestDto(cancelled);
  }

  if (request.status !== hrRequestStatuses.APPROVED) throw conflict('Leave request cannot be cancelled');
  assertCanApprove(request, authContext);
  const firstDate = request.workingDateSnapshots[0];
  const today = localDateKey(new Date(), firstDate.scheduleSnapshot.timezone);
  if (today >= firstDate.dateKey) {
    throw conflict('Approved leave can only be cancelled before it starts');
  }

  const cancelled = await runTransaction(async (session) => {
    await attendanceService.reverseApprovedLeave(toId(request.profileId), requestId, { session });
    if (request.leaveType === 'ANNUAL') {
      const refunded = await repository.refundBalanceUnits(
        toId(request.profileId),
        request.year,
        request.leaveType,
        request.requestedUnits,
        {
          ...cancellation,
          requestId,
          action: 'REFUND',
          units: request.requestedUnits,
        },
        { session },
      );
      if (refunded.modifiedCount !== 1) throw conflict('Leave balance cannot be refunded');
    }
    const updated = await repository.transitionRequest(requestId, hrRequestStatuses.APPROVED, {
      status: hrRequestStatuses.CANCELLED,
      cancellation,
    }, { session });
    if (!updated) throw conflict('Leave request changed before cancellation');
    return updated;
  });
  await notifyLeave(cancelled);
  await recordLeaveAudit(cancelled, authContext.accountId);
  return toLeaveRequestDto(cancelled);
}

module.exports = {
  accrueBalances,
  adjustBalance,
  approveRequest,
  attachReferences,
  cancelRequest,
  carryOverBalances,
  createRequest,
  getBalance,
  getMyBalances,
  listRequests,
  previewRequest,
  refundRequest,
  rejectRequest,
  resetBalances,
  upsertBalance,
};
