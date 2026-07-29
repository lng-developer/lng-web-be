const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const auditPublic = require('../../audit/public');
const logger = require('../../../shared/utils/logger');
const { hrAttendanceStatuses, hrTimePermissions } = require('../constants/hr.constants');
const { toAttendanceDto, toPaginatedAttendanceDto } = require('../dtos/attendance.dto');
const profileRepository = require('../repositories/employeeProfile.repository');
const repository = require('../repositories/attendance.repository');
const scheduleRepository = require('../repositories/schedule.repository');
const { resolveAttendanceDay } = require('./attendanceResolution.service');
const scheduleResolver = require('./scheduleResolver.service');

function conflict(message) {
  return new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function attendanceAuditScope(record = {}) {
  const snapshot = record.scheduleSnapshot || {};
  if (snapshot.teamId) return { scopeType: 'TEAM', scopeId: toId(snapshot.teamId) };
  if (snapshot.departmentId) return { scopeType: 'DEPARTMENT', scopeId: toId(snapshot.departmentId) };
  return { scopeType: null, scopeId: null };
}

function attendanceMutationIdentity(record = {}) {
  if (record.auditOperationKey) return `operation:${record.auditOperationKey}`;
  const adjustment = (record.manualAdjustments || []).at(-1);
  const timestamp = adjustment?.adjustedAt || record.updatedAt || record.checkOutAt || record.checkInAt || record.createdAt;
  if (timestamp) return `time:${new Date(timestamp).toISOString()}`;
  return Number.isInteger(record.__v) ? `version:${record.__v}` : 'persisted';
}

async function recordAttendanceAudit({
  action,
  record,
  authContext = {},
  entityType = 'HR_ATTENDANCE_DAILY',
  entityId = toId(record),
  source = 'HTTP',
  outcome = 'SUCCEEDED',
  metadata = {},
}) {
  try {
    await auditPublic.record({
      actorType: authContext.accountId ? 'ACCOUNT' : 'SYSTEM',
      actorAccountId: authContext.accountId || null,
      actorSnapshot: {},
      action,
      entityType,
      entityId: String(entityId),
      ...(entityType === 'HR_ATTENDANCE_DAILY' ? attendanceAuditScope(record) : {
        scopeType: null, scopeId: null,
      }),
      outcome,
      source,
      changes: null,
      metadata,
      deduplicationKey: `hr:${action.toLowerCase()}:${entityId}:${attendanceMutationIdentity(record)}`,
    }, {});
  } catch (error) {
    logger.warn('hr_attendance_audit_write_failed', { action, entityId: String(entityId), error });
  }
}

function toDate(value, field = 'occurredAt') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${field} is invalid`, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  return date;
}

function dateKeyFromInstant(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
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

function buildScheduleSnapshot(context) {
  const plannedStartAt = zonedDateTimeToUtc(
    context.workDateKey,
    context.shift.startTime,
    context.workLocation.timezone,
  );
  const plannedEndAt = zonedDateTimeToUtc(
    context.shift.isOvernight ? addDateKey(context.workDateKey, 1) : context.workDateKey,
    context.shift.endTime,
    context.workLocation.timezone,
  );
  return {
    assignmentId: toId(context.assignment?.id),
    departmentId: toId(context.profile?.departmentId),
    teamId: toId(context.profile?.teamId),
    timezone: context.workLocation.timezone,
    plannedStartAt,
    plannedEndAt,
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
    calendarOverride: context.calendarOverride || null,
  };
}

function workedSchedule(scheduleSnapshot, leaveSegments = []) {
  const leaveUnits = leaveSegments.reduce((total, segment) => total + (segment.units || 0), 0);
  if (leaveUnits !== 1 || leaveSegments.length !== 1) return scheduleSnapshot;

  const start = new Date(scheduleSnapshot.plannedStartAt);
  const end = new Date(scheduleSnapshot.plannedEndAt);
  const breakMinutes = scheduleSnapshot.shift?.breakMinutes || 0;
  const workedHalfMinutes = Math.max(0, Math.floor(((end - start) / 60000 - breakMinutes) / 2));
  if (leaveSegments[0].portion === 'MORNING') {
    return {
      ...scheduleSnapshot,
      plannedStartAt: new Date(end.getTime() - (workedHalfMinutes * 60000)),
      shift: { ...scheduleSnapshot.shift, breakMinutes: 0 },
    };
  }
  if (leaveSegments[0].portion === 'AFTERNOON') {
    return {
      ...scheduleSnapshot,
      plannedEndAt: new Date(start.getTime() + (workedHalfMinutes * 60000)),
      shift: { ...scheduleSnapshot.shift, breakMinutes: 0 },
    };
  }
  return scheduleSnapshot;
}

function metrics({ checkInAt, checkOutAt, scheduleSnapshot, leaveSegments = [] }) {
  const effectiveSchedule = workedSchedule(scheduleSnapshot, leaveSegments);
  const graceMinutes = effectiveSchedule.shift?.graceMinutes || 0;
  const breakMinutes = effectiveSchedule.shift?.breakMinutes || 0;
  const lateDifference = checkInAt
    ? Math.floor((checkInAt.getTime() - new Date(effectiveSchedule.plannedStartAt).getTime()) / 60000)
    : 0;
  const earlyDifference = checkOutAt
    ? Math.floor((new Date(effectiveSchedule.plannedEndAt).getTime() - checkOutAt.getTime()) / 60000)
    : 0;
  const workedDifference = checkInAt && checkOutAt
    ? Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 60000) - breakMinutes
    : 0;
  return {
    lateMinutes: Math.max(0, lateDifference - graceMinutes),
    earlyLeaveMinutes: Math.max(0, earlyDifference),
    workedMinutes: Math.max(0, workedDifference),
  };
}

function timeInTimezone(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.hour}:${parts.minute}`;
}

function shiftConfig(snapshot) {
  const parse = (value) => {
    const [hour, minute] = String(value).split(':').map(Number);
    return (hour * 60) + minute;
  };
  const totalMinutes = Math.max(0, (snapshot.shift?.durationMinutes || 0) - (snapshot.shift?.breakMinutes || 0));
  return {
    standardInMin: parse(snapshot.shift.startTime),
    standardOutMin: parse(snapshot.shift.endTime),
    morningEndMin: 690,
    afternoonStartMin: 780,
    forcedTotalBlocks: Math.max(1, Math.round(totalMinutes / 15)),
    blockMinutes: 15,
  };
}

function leaveInput(segments = []) {
  if (!segments.length) return null;
  if (segments.length > 1) {
    const statuses = new Set(segments.map((segment) => segment.attendanceStatus));
    const paidUnits = segments.reduce((total, segment) => (
      total + (segment.attendanceStatus === hrAttendanceStatuses.PAID_LEAVE ? segment.units : 0)
    ), 0);
    return {
      status: 'APPROVED',
      attendanceStatus: statuses.size === 1 ? segments[0].attendanceStatus : hrAttendanceStatuses.MIXED_LEAVE,
      leaveScope: 'FULL_DAY',
      workDayValue: paidUnits / 2,
    };
  }
  const segment = segments[0];
  return {
    status: 'APPROVED',
    requestId: toId(segment.requestId),
    attendanceStatus: segment.attendanceStatus,
    leaveScope: segment.portion,
  };
}

function attendanceResolution({
  existingAttendance,
  checkInAt,
  checkOutAt,
  scheduleSnapshot,
  leaveSegments = [],
  manualStatus,
  manualWorkDayValue,
}) {
  const automatic = resolveAttendanceDay({
    holiday: scheduleSnapshot.calendarStatus === 'HOLIDAY'
      ? { holidayType: 'PUBLIC_HOLIDAY', isApplicable: true, isWorkDay: false }
      : null,
    isSunday: new Date(`${scheduleSnapshot.workDateKey || '1970-01-01'}T00:00:00.000Z`).getUTCDay() === 0,
    isRotationOff: scheduleSnapshot.calendarStatus === 'REST_DAY',
    leave: leaveInput(leaveSegments),
    leaveValues: { morningValue: 0.4375, afternoonValue: 0.5625 },
    shiftConfig: shiftConfig(scheduleSnapshot),
    swipe: {
      checkIn: checkInAt ? timeInTimezone(checkInAt, scheduleSnapshot.timezone) : null,
      checkOut: checkOutAt ? timeInTimezone(checkOutAt, scheduleSnapshot.timezone) : null,
    },
  });
  if (!existingAttendance?.isManualEdited && manualStatus === undefined) return automatic;
  const fixedValues = {
    HOLIDAY: 1,
    PAID_LEAVE: 1,
    ABSENT: 0,
    ERROR: 0,
    REST_DAY: 0,
    UNPAID_LEAVE: 0,
  };
  return resolveAttendanceDay({
    existingAttendance: {
      isManualEdited: true,
      status: manualStatus || existingAttendance.status,
      workDayValue: manualWorkDayValue
        ?? fixedValues[manualStatus]
        ?? existingAttendance.workDayValue
        ?? automatic.workDayValue,
      leaveRequestId: automatic.leaveRequestId,
    },
  });
}

function resolutionPatch(resolution) {
  return {
    status: resolution.status,
    workDayValue: resolution.workDayValue,
    calculationReason: resolution.calculationReason,
  };
}

function validateAttendanceImport({ sourceBatchId, punches }) {
  if (!String(sourceBatchId || '').trim()) {
    throw new AppError('sourceBatchId is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  if (!Array.isArray(punches) || !punches.length) {
    throw new AppError('punches must be a non-empty array', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

async function importAttendancePunches(payload, dependencies = {}) {
  validateAttendanceImport(payload || {});
  const employeeProfiles = dependencies.profileRepository || profileRepository;
  const attendanceRecords = dependencies.attendanceRepository || repository;
  const calendarPolicies = dependencies.calendarPolicyService || require('./calendarPolicy.service');
  const batches = dependencies.batchRepository || require('../repositories/attendanceImportBatch.repository');
  const sourceBatchId = String(payload.sourceBatchId).trim();
  const completed = await batches.findBySourceBatchId(sourceBatchId);
  if (completed?.status === 'COMPLETED') {
    return { inserted: 0, updated: 0, unchanged: payload.punches.length, failed: 0 };
  }
  await batches.start(sourceBatchId, payload.punches.length);

  const groups = new Map();
  let failed = 0;
  for (const punch of payload.punches) {
    const occurredAt = toDate(punch?.occurredAt);
    const employeeCode = String(punch?.employeeCode || '').trim().toUpperCase();
    if (!employeeCode || !String(punch?.sourceId || '').trim()) {
      failed += 1;
      continue;
    }
    const profile = await employeeProfiles.findByEmployeeCode(employeeCode);
    if (!profile) {
      failed += 1;
      continue;
    }
    const workDateKey = dateKeyFromInstant(occurredAt, 'Asia/Ho_Chi_Minh');
    const key = `${toId(profile)}:${workDateKey}`;
    const group = groups.get(key) || { profile, workDateKey, punches: [] };
    group.punches.push({ ...punch, occurredAt });
    groups.set(key, group);
  }

  const result = { inserted: 0, updated: 0, unchanged: 0, failed };
  for (const group of groups.values()) {
    try {
      const profileId = toId(group.profile);
      const existing = await attendanceRecords.findByProfileAndWorkDate(profileId, group.workDateKey);
      if (existing?.sourceBatchIds?.includes(sourceBatchId) || existing?.isManualEdited) {
        result.unchanged += group.punches.length;
        continue;
      }
      const policy = await calendarPolicies.resolveCalendarPolicy({ profileId, workDateKey: group.workDateKey });
      const context = { ...policy.scheduleSnapshot, workDateKey: group.workDateKey };
      if (!context.workLocation?.timezone || !context.shift?.startTime || !context.shift?.endTime) {
        throw conflict(`Effective work schedule is unavailable for ${group.workDateKey}`);
      }
      const snapshot = existing?.scheduleSnapshot || buildScheduleSnapshot(context);
      const instants = [
        ...(existing?.checkInAt ? [new Date(existing.checkInAt)] : []),
        ...(existing?.checkOutAt ? [new Date(existing.checkOutAt)] : []),
        ...group.punches.map((punch) => punch.occurredAt),
      ].sort((left, right) => left - right);
      const checkInAt = instants[0];
      const checkOutAt = instants.length > 1 ? instants[instants.length - 1] : null;
      const resolution = resolveAttendanceDay({
        existingAttendance: existing?.isManualEdited ? existing : null,
        holiday: policy.holiday,
        isSunday: policy.isSunday,
        isRotationOff: policy.isRotationOff,
        leave: leaveInput(existing?.leaveSegments),
        leaveValues: { morningValue: 0.4375, afternoonValue: 0.5625 },
        shiftConfig: shiftConfig(snapshot),
        swipe: {
          checkIn: timeInTimezone(checkInAt, snapshot.timezone),
          checkOut: checkOutAt ? timeInTimezone(checkOutAt, snapshot.timezone) : null,
        },
      });
      const patch = {
        profileId,
        workDateKey: group.workDateKey,
        status: resolution.status,
        workDayValue: resolution.workDayValue,
        calculationReason: resolution.calculationReason,
        checkInAt,
        checkOutAt,
        source: 'SQL_ATTENDANCE',
        scheduleSnapshot: snapshot,
        leaveSegments: existing?.leaveSegments || [],
        manualAdjustments: existing?.manualAdjustments || [],
        sourceBatchIds: [...new Set([...(existing?.sourceBatchIds || []), sourceBatchId])],
        ...metrics({ checkInAt, checkOutAt, scheduleSnapshot: snapshot, leaveSegments: existing?.leaveSegments }),
      };
      if (existing) {
        await attendanceRecords.updateById(toId(existing), patch);
        result.updated += group.punches.length;
      } else {
        await attendanceRecords.createDaily(patch);
        result.inserted += group.punches.length;
      }
    } catch (_error) {
      result.failed += group.punches.length;
    }
  }

  if (result.failed) await batches.fail(sourceBatchId, result);
  else await batches.complete(sourceBatchId, result);
  await recordAttendanceAudit({
    action: 'HR_ATTENDANCE_IMPORTED',
    record: { auditOperationKey: `${result.failed ? 'FAILED' : 'COMPLETED'}:${result.inserted}:${result.updated}:${result.unchanged}:${result.failed}` },
    entityType: 'HR_ATTENDANCE_IMPORT_BATCH',
    entityId: sourceBatchId,
    source: 'IMPORT',
    outcome: result.failed ? 'FAILED' : 'SUCCEEDED',
    metadata: result,
  });
  return result;
}

async function getRequiredSelfProfile(authContext = {}) {
  if (!authContext.accountId) throw forbidden();
  const profile = await profileRepository.findByAccountId(authContext.accountId);
  if (!profile || profile.isDeleted) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return profile;
}

async function resolveContextForInstant(profileId, occurredAt) {
  const utcDateKey = occurredAt.toISOString().slice(0, 10);
  const dateKeys = [-1, 0, 1].map((offset) => addDateKey(utcDateKey, offset));
  const contexts = await Promise.all(dateKeys.map((workDateKey) => (
    scheduleResolver.resolveWorkContext({ profileId, workDateKey })
  )));

  const candidates = contexts.filter((context) => context?.workLocation?.timezone && context?.shift);
  const precedingOvernight = candidates.find((context) => {
    const localDateKey = dateKeyFromInstant(occurredAt, context.workLocation.timezone);
    if (!context.shift.isOvernight || localDateKey !== addDateKey(context.workDateKey, 1)) return false;
    const snapshot = buildScheduleSnapshot(context);
    return occurredAt >= snapshot.plannedStartAt && occurredAt <= snapshot.plannedEndAt;
  });
  if (precedingOvernight) return precedingOvernight;

  return candidates.find((context) => (
    dateKeyFromInstant(occurredAt, context.workLocation.timezone) === context.workDateKey
  )) || { status: 'SCHEDULE_UNRESOLVED' };
}

function canCheckInToRecord(record) {
  if (!record) return true;
  const leaveUnits = (record.leaveSegments || []).reduce((total, segment) => total + segment.units, 0);
  return leaveUnits === 1 && !record.checkInAt && !record.checkOutAt;
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

async function checkIn(authContext, { occurredAt }) {
  const instant = toDate(occurredAt);
  const profile = await getRequiredSelfProfile(authContext);
  if (await repository.findOpenByProfile(toId(profile))) {
    throw conflict('An attendance record is already open');
  }
  const context = await resolveContextForInstant(toId(profile), instant);
  if (context.status === 'SCHEDULE_UNRESOLVED') throw conflict('Effective work schedule is unavailable');
  if (!context.isWorkingDay || context.status !== 'WORKING_DAY') throw conflict('Check-in is not allowed on this work date');

  const existing = await repository.findByProfileAndWorkDate(toId(profile), context.workDateKey);
  if (existing) {
    const leaveUnits = (existing.leaveSegments || []).reduce((total, segment) => total + segment.units, 0);
    if (canCheckInToRecord(existing)) {
      const scheduleSnapshot = existing.scheduleSnapshot;
      const resolved = attendanceResolution({
        existingAttendance: existing,
        checkInAt: instant,
        checkOutAt: null,
        scheduleSnapshot: { ...scheduleSnapshot, workDateKey: context.workDateKey },
        leaveSegments: existing.leaveSegments,
      });
      const updated = await repository.updateLeaveProjection(toId(existing), {
        ...resolutionPatch(resolved),
        checkInAt: instant,
        checkOutAt: null,
        source: 'SELF_SERVICE',
        ...metrics({ checkInAt: instant, checkOutAt: null, scheduleSnapshot, leaveSegments: existing.leaveSegments }),
      }, { requireAvailableHalfDay: true });
      if (!updated) throw conflict('Attendance or approved leave changed before check-in');
      await recordAttendanceAudit({
        action: 'HR_ATTENDANCE_CHECKED_IN',
        record: updated,
        authContext,
        metadata: { profileId: toId(profile), workDateKey: updated.workDateKey },
      });
      return toAttendanceDto(updated);
    }
    throw conflict(
      leaveUnits >= 2
        || [hrAttendanceStatuses.PAID_LEAVE, hrAttendanceStatuses.UNPAID_LEAVE].includes(existing.status)
        ? 'Approved leave already exists for this work date'
        : 'Attendance already exists for this work date',
    );
  }

  const scheduleSnapshot = buildScheduleSnapshot(context);
  const resolved = attendanceResolution({
    checkInAt: instant,
    checkOutAt: null,
    scheduleSnapshot: { ...scheduleSnapshot, workDateKey: context.workDateKey },
  });
  const payload = {
    profileId: toId(profile),
    workDateKey: context.workDateKey,
    ...resolutionPatch(resolved),
    checkInAt: instant,
    checkOutAt: null,
    source: 'SELF_SERVICE',
    isManualEdited: false,
    scheduleSnapshot,
    ...metrics({ checkInAt: instant, checkOutAt: null, scheduleSnapshot }),
  };
  try {
    const created = await repository.createDaily(payload);
    await recordAttendanceAudit({
      action: 'HR_ATTENDANCE_CHECKED_IN',
      record: created,
      authContext,
      metadata: { profileId: toId(profile), workDateKey: created.workDateKey },
    });
    return toAttendanceDto(created);
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('Attendance already exists for this work date');
    throw error;
  }
}

function isEligibleOpenRecord(record, occurredAt) {
  const timezone = record.scheduleSnapshot?.timezone;
  if (!timezone || !record.workDateKey || !record.checkInAt || occurredAt < new Date(record.checkInAt)) return false;
  const localDateKey = dateKeyFromInstant(occurredAt, timezone);
  if (localDateKey === record.workDateKey) return true;
  return Boolean(record.scheduleSnapshot.shift?.isOvernight)
    && localDateKey === addDateKey(record.workDateKey, 1);
}

async function selfAttendanceCapabilities(profile, instant = new Date()) {
  const profileId = toId(profile);
  const openRecord = await repository.findOpenByProfile(profileId);
  if (openRecord && isEligibleOpenRecord(openRecord, instant)) {
    return { checkIn: false, checkOut: true };
  }
  // A stale open record would also make check-in fail. Do not offer an action the API cannot accept.
  if (openRecord) return { checkIn: false, checkOut: false };

  const context = await resolveContextForInstant(profileId, instant);
  if (!context.isWorkingDay || context.status !== 'WORKING_DAY') {
    return { checkIn: false, checkOut: false };
  }

  const current = await repository.findByProfileAndWorkDate(profileId, context.workDateKey);
  return {
    checkIn: canCheckInToRecord(current),
    checkOut: false,
  };
}

async function checkOut(authContext, { occurredAt }) {
  const instant = toDate(occurredAt);
  const profile = await getRequiredSelfProfile(authContext);
  const current = await repository.findOpenByProfile(toId(profile));
  if (!current || !isEligibleOpenRecord(current, instant)) {
    throw conflict('No eligible open attendance record');
  }

  const computed = metrics({
    checkInAt: new Date(current.checkInAt),
    checkOutAt: instant,
    scheduleSnapshot: current.scheduleSnapshot,
    leaveSegments: current.leaveSegments,
  });
  const resolved = attendanceResolution({
    existingAttendance: current,
    checkInAt: new Date(current.checkInAt),
    checkOutAt: instant,
    scheduleSnapshot: { ...current.scheduleSnapshot, workDateKey: current.workDateKey },
    leaveSegments: current.leaveSegments,
  });
  const closed = await repository.closeOpenById(toId(current), {
    checkOutAt: instant,
    ...resolutionPatch(resolved),
    ...computed,
  });
  if (!closed) throw conflict('Attendance has already been checked out');
  await recordAttendanceAudit({
    action: 'HR_ATTENDANCE_CHECKED_OUT',
    record: closed,
    authContext,
    metadata: { profileId: toId(profile), workDateKey: closed.workDateKey },
  });
  return toAttendanceDto(closed);
}

function hasGlobalPermission(authContext, permissions) {
  return permissions.some((permission) => (authContext.permissions || []).includes(permission));
}

function buildScopeFilters(authContext, permissions) {
  return (authContext.scopes || []).flatMap((scope) => {
    if (!permissions.some((permission) => (scope.permissions || []).includes(permission))) return [];
    if (scope.scopeType === 'team' && scope.scopeId) return [{ 'scheduleSnapshot.teamId': String(scope.scopeId) }];
    if (scope.scopeType === 'department' && scope.scopeId) return [{ 'scheduleSnapshot.departmentId': String(scope.scopeId) }];
    return [];
  });
}

function buildProfileScopeFilters(authContext, permissions) {
  return (authContext.scopes || []).flatMap((scope) => {
    if (!permissions.some((permission) => (scope.permissions || []).includes(permission))) return [];
    if (scope.scopeType === 'team' && scope.scopeId) return [{ teamId: String(scope.scopeId) }];
    if (scope.scopeType === 'department' && scope.scopeId) return [{ departmentId: String(scope.scopeId) }];
    return [];
  });
}

function monthDateKeys(year, month) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_value, index) => `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`);
}

function isoWeekday(dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return weekday || 7;
}

function plannedCells(assignments, shifts, days) {
  const shiftsById = new Map(shifts.map((shift) => [toId(shift), shift]));
  const assignmentsByProfile = assignments.reduce((result, assignment) => {
    const profileId = toId(assignment.profileId);
    result.set(profileId, [...(result.get(profileId) || []), assignment]);
    return result;
  }, new Map());
  const cells = new Map();
  assignmentsByProfile.forEach((profileAssignments, profileId) => {
    days.forEach((dateKey) => {
      const assignment = profileAssignments.find((item) => (
        item.effectiveFrom <= dateKey && (!item.effectiveTo || item.effectiveTo >= dateKey)
      ));
      const shift = assignment && shiftsById.get(toId(assignment.shiftId));
      if (!shift) return;
      const key = `${profileId}:${dateKey}`;
      if (!(shift.workdays || []).includes(isoWeekday(dateKey))) {
        cells.set(key, { emptyReason: 'REST_DAY' });
        return;
      }
      cells.set(key, {
        emptyReason: 'NO_RECORD',
        plannedShift: {
          id: toId(shift), code: shift.code || null, name: shift.name || null,
          startTime: shift.startTime || null, endTime: shift.endTime || null,
        },
      });
    });
  });
  return cells;
}

function publicProfile(profile) {
  return {
    id: toId(profile),
    employeeCode: profile.employeeCode || null,
    fullName: profile.fullName || null,
    teamId: toId(profile.teamId),
    departmentId: toId(profile.departmentId),
  };
}

function toEmployeeSummary(profile) {
  if (!profile) return null;
  return { id: toId(profile), employeeCode: profile.employeeCode || null, fullName: profile.fullName || null };
}

async function toAttendancePage(result, authContext, actorProfile = null) {
  const profiles = await profileRepository.listByIds?.((result.items || []).map((record) => record.profileId)) || [];
  const profilesById = new Map(profiles.map((profile) => [toId(profile), profile]));
  const page = toPaginatedAttendanceDto(result, (record) => ({
    employee: toEmployeeSummary(profilesById.get(toId(record.profileId))),
    capabilities: {
      view: true,
      adjust: Boolean(authContext.accountId && canManageRecord(authContext, actorProfile, record)),
    },
  }));
  return result.summary ? { ...page, summary: result.summary } : page;
}

async function listAttendance(query = {}, authContext = {}) {
  if (query.own) {
    const profile = await getRequiredSelfProfile(authContext);
    const { own: _own, ...safeQuery } = query;
    const [page, capabilities] = await Promise.all([
      repository.list({ ...safeQuery, profileId: toId(profile) })
        .then((result) => toAttendancePage(result, authContext, profile)),
      selfAttendanceCapabilities(profile),
    ]);
    return { ...page, capabilities };
  }

  const permissions = [hrTimePermissions.ATTENDANCE_READ, hrTimePermissions.ATTENDANCE_MANAGE];
  const actorProfile = authContext.accountId ? await profileRepository.findByAccountId(authContext.accountId) : null;
  if (hasGlobalPermission(authContext, permissions)) {
    return toAttendancePage(await repository.list(query), authContext, actorProfile);
  }
  const scopeFilters = buildScopeFilters(authContext, permissions);
  if (!scopeFilters.length) throw forbidden();
  return toAttendancePage(await repository.list({ ...query, scopeFilters }), authContext, actorProfile);
}

async function listMonthMatrix(query = {}, authContext = {}) {
  const permissions = [hrTimePermissions.ATTENDANCE_READ, hrTimePermissions.ATTENDANCE_MANAGE];
  const scopeFilters = hasGlobalPermission(authContext, permissions)
    ? []
    : buildProfileScopeFilters(authContext, permissions);
  if (!hasGlobalPermission(authContext, permissions) && !scopeFilters.length) throw forbidden();

  const profiles = await profileRepository.list({
    teamId: query.teamId,
    departmentId: query.departmentId,
    q: query.q,
    scopeFilters,
    page: query.page,
    limit: query.limit,
  });
  const days = monthDateKeys(query.year, query.month);
  const profileIds = profiles.items.map(toId);
  const [records, assignments] = await Promise.all([
    repository.listByProfileIdsAndDateRange(profileIds, days[0], days.at(-1), query),
    scheduleRepository.listAssignmentsEffectiveForProfiles(profileIds, days[0], days.at(-1), { shiftId: query.shiftId }),
  ]);
  const shifts = await scheduleRepository.findShiftsByIds(assignments.map((assignment) => assignment.shiftId));
  const plannedByProfileAndDate = plannedCells(assignments, shifts, days);
  const recordsByProfileAndDate = new Map(records.map((record) => [`${toId(record.profileId)}:${record.workDateKey}`, record]));
  const actorProfile = authContext.accountId ? await profileRepository.findByAccountId(authContext.accountId) : null;
  const items = profiles.items.map((profile) => ({
    profile: publicProfile(profile),
    cells: days.map((dateKey) => {
      const record = recordsByProfileAndDate.get(`${toId(profile)}:${dateKey}`);
      if (!record) {
        const planned = plannedByProfileAndDate.get(`${toId(profile)}:${dateKey}`);
        return { dateKey, ...(planned || { emptyReason: 'UNASSIGNED' }), capabilities: { adjust: false } };
      }
      const dto = toAttendanceDto(record, { employee: publicProfile(profile), capabilities: { adjust: canManageRecord(authContext, actorProfile, record) } });
      return { ...dto, dateKey, emptyReason: null };
    }),
    capabilities: { view: true },
  }));
  const summary = records.reduce((result, record) => ({
    ...result,
    totalRecords: result.totalRecords + 1,
    statusCounts: { ...result.statusCounts, [record.status]: (result.statusCounts[record.status] || 0) + 1 },
  }), { totalRecords: 0, statusCounts: {} });
  return {
    month: { year: query.year, month: query.month, timezone: records[0]?.scheduleSnapshot?.timezone || null },
    days: days.map((dateKey) => ({ dateKey })),
    items,
    summary,
    pagination: profiles.pagination,
    capabilities: { viewTeamMatrix: true },
  };
}

function attendanceValues(record) {
  return {
    status: record.status,
    checkInAt: record.checkInAt || null,
    checkOutAt: record.checkOutAt || null,
    lateMinutes: record.lateMinutes ?? 0,
    earlyLeaveMinutes: record.earlyLeaveMinutes ?? 0,
    workedMinutes: record.workedMinutes ?? 0,
  };
}

function canManageRecord(authContext, actorProfile, record) {
  const permission = hrTimePermissions.ATTENDANCE_MANAGE;
  if (authPublic.canAccessScope(authContext, permission, {
    scopeType: 'team', scopeId: record.scheduleSnapshot?.teamId || null,
  })) return true;
  if (authPublic.canAccessScope(authContext, permission, {
    scopeType: 'department', scopeId: record.scheduleSnapshot?.departmentId || null,
  })) return true;
  return toId(actorProfile) === toId(record.profileId)
    && authPublic.canAccessScope(authContext, permission, { scopeType: 'own', scopeId: authContext.accountId });
}

async function adjustAttendance(attendanceId, payload, authContext = {}) {
  const current = await repository.findById(attendanceId);
  if (!current) {
    throw new AppError('Attendance not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  if (!authContext.accountId) throw forbidden();
  const actorProfile = await profileRepository.findByAccountId(authContext.accountId);
  if (!canManageRecord(authContext, actorProfile, current)) throw forbidden();
  const authModel = actorProfile ? null : await authPublic.getCurrentAccount(authContext.accountId);
  const actorName = actorProfile?.fullName || authModel?.account?.email || null;
  const reason = String(payload.reason || '').trim();
  if (!reason) {
    throw new AppError('Adjustment reason is required', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  const checkInAt = Object.hasOwn(payload, 'checkInAt')
    ? (payload.checkInAt === null ? null : toDate(payload.checkInAt, 'checkInAt'))
    : (current.checkInAt ? new Date(current.checkInAt) : null);
  const checkOutAt = Object.hasOwn(payload, 'checkOutAt')
    ? (payload.checkOutAt === null ? null : toDate(payload.checkOutAt, 'checkOutAt'))
    : (current.checkOutAt ? new Date(current.checkOutAt) : null);
  if (checkInAt && checkOutAt && checkOutAt < checkInAt) {
    throw new AppError('checkOutAt must not be before checkInAt', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }

  const before = attendanceValues(current);
  const after = {
    checkInAt,
    checkOutAt,
    ...metrics({
      checkInAt,
      checkOutAt,
      scheduleSnapshot: current.scheduleSnapshot,
      leaveSegments: current.leaveSegments,
    }),
  };
  const resolved = attendanceResolution({
    existingAttendance: { ...current, isManualEdited: true },
    checkInAt,
    checkOutAt,
    scheduleSnapshot: { ...current.scheduleSnapshot, workDateKey: current.workDateKey },
    leaveSegments: current.leaveSegments,
    manualStatus: payload.status || current.status,
    manualWorkDayValue: payload.workDayValue,
  });
  Object.assign(after, resolutionPatch(resolved));
  const adjustment = {
    actorId: authContext.accountId,
    actorName,
    reason,
    adjustedAt: new Date(),
    before,
    after,
  };
  const updated = await repository.appendAdjustment(attendanceId, current.updatedAt, {
    ...after,
    source: 'MANAGED',
    isManualEdited: true,
  }, adjustment);
  if (!updated) throw conflict('Attendance changed before this adjustment was saved');
  await recordAttendanceAudit({
    action: 'HR_ATTENDANCE_CORRECTED',
    record: updated,
    authContext,
    metadata: {
      profileId: toId(updated.profileId),
      workDateKey: updated.workDateKey,
      changedFields: Object.keys(payload).filter((key) => key !== 'reason').sort(),
    },
  });
  return toAttendanceDto(updated);
}

function assertLeaveAttendanceStatus(attendanceStatus) {
  if (![
    hrAttendanceStatuses.PAID_LEAVE,
    hrAttendanceStatuses.UNPAID_LEAVE,
  ].includes(attendanceStatus)) {
    throw new AppError(
      'attendanceStatus must be PAID_LEAVE or UNPAID_LEAVE',
      httpStatus.BAD_REQUEST,
      true,
      errorCodes.VALIDATION_ERROR,
    );
  }
}

function buildLeaveScheduleSnapshot(workDateKey, snapshot) {
  if (!snapshot?.timezone || !snapshot?.shift?.startTime || !snapshot?.shift?.endTime) {
    throw conflict(`Saved work schedule is unavailable for ${workDateKey}`);
  }
  return {
    ...snapshot,
    plannedStartAt: zonedDateTimeToUtc(workDateKey, snapshot.shift.startTime, snapshot.timezone),
    plannedEndAt: zonedDateTimeToUtc(
      snapshot.shift.isOvernight ? addDateKey(workDateKey, 1) : workDateKey,
      snapshot.shift.endTime,
      snapshot.timezone,
    ),
    shift: {
      ...snapshot.shift,
      graceMinutes: snapshot.shift.graceMinutes ?? 0,
    },
  };
}

function portionsConflict(existingPortion, requestedPortion) {
  return existingPortion === 'FULL_DAY'
    || requestedPortion === 'FULL_DAY'
    || existingPortion === requestedPortion;
}

async function runInTransaction(session, work) {
  if (session) return work(session);
  const ownedSession = await mongoose.startSession();
  try {
    let result;
    await ownedSession.withTransaction(async () => { result = await work(ownedSession); });
    return result;
  } finally {
    await ownedSession.endSession();
  }
}

async function reconcileApprovedLeave(request, { session } = {}) {
  assertLeaveAttendanceStatus(request?.attendanceStatus);
  const profileId = toId(request?.profileId);
  const requestId = toId(request);
  if (!profileId || !requestId || !['FULL_DAY', 'MORNING', 'AFTERNOON'].includes(request?.portion)) {
    throw new AppError('Approved leave projection is invalid', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  const uniqueSnapshots = [...new Map(
    (request.workingDateSnapshots || []).map((entry) => [entry.dateKey, entry]),
  ).values()];
  if (!uniqueSnapshots.length) throw conflict('Approved leave has no saved working dates');

  return runInTransaction(session, async (activeSession) => {
    const candidates = uniqueSnapshots.map((entry) => ({
      workDateKey: entry.dateKey,
      units: entry.units,
      scheduleSnapshot: buildLeaveScheduleSnapshot(entry.dateKey, entry.scheduleSnapshot),
    }));
    const expectedUnits = request.portion === 'FULL_DAY' ? 2 : 1;
    if (candidates.some(({ units }) => units !== expectedUnits)) {
      throw new AppError('Approved leave units do not match its portion', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
    }
    const existingRecords = await Promise.all(candidates.map(({ workDateKey }) => (
      repository.findByProfileAndWorkDate(profileId, workDateKey, { session: activeSession })
    )));
    const projections = candidates.map((candidate, index) => {
      const existing = existingRecords[index];
      const segments = existing?.leaveSegments || [];
      if (segments.some((segment) => toId(segment.requestId) === requestId)) {
        return { ...candidate, existing, skip: true };
      }
      if (segments.some((segment) => portionsConflict(segment.portion, request.portion))) {
        throw conflict(`Approved leave overlaps attendance projection for ${candidate.workDateKey}`);
      }
      const nextSegments = [...segments, {
        requestId,
        portion: request.portion,
        units: candidate.units,
        attendanceStatus: request.attendanceStatus,
      }];
      const leaveUnits = nextSegments.reduce((total, segment) => total + segment.units, 0);
      if (leaveUnits > 2 || (leaveUnits >= 2 && (existing?.checkInAt || existing?.checkOutAt))) {
        throw conflict(`Attendance already exists for ${candidate.workDateKey}`);
      }
      if (
        existing
        && !existing.isManualEdited
        && !segments.length
        && !existing.checkInAt
        && !existing.checkOutAt
        && existing.source !== 'LEAVE_RECONCILIATION'
      ) {
        throw conflict(`Attendance already exists for ${candidate.workDateKey}`);
      }
      return { ...candidate, existing, nextSegments };
    });

    const records = [];
    for (const projection of projections) {
      if (projection.skip) {
        records.push(toAttendanceDto(projection.existing));
        continue;
      }
      const resolved = attendanceResolution({
        existingAttendance: projection.existing,
        checkInAt: projection.existing?.checkInAt ? new Date(projection.existing.checkInAt) : null,
        checkOutAt: projection.existing?.checkOutAt ? new Date(projection.existing.checkOutAt) : null,
        scheduleSnapshot: { ...projection.scheduleSnapshot, workDateKey: projection.workDateKey },
        leaveSegments: projection.nextSegments,
      });
      try {
        const record = projection.existing
          ? await repository.updateLeaveProjection(toId(projection.existing), {
            ...resolutionPatch(resolved),
            leaveSegments: projection.nextSegments,
          }, { session: activeSession })
          : await repository.createDaily({
            profileId,
            workDateKey: projection.workDateKey,
            ...resolutionPatch(resolved),
            source: 'LEAVE_RECONCILIATION',
            scheduleSnapshot: projection.scheduleSnapshot,
            leaveSegments: projection.nextSegments,
            checkInAt: null,
            checkOutAt: null,
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
            workedMinutes: 0,
          }, { session: activeSession });
        if (!record) throw conflict(`Attendance changed for ${projection.workDateKey}`);
        records.push(toAttendanceDto(record));
      } catch (error) {
        if (isDuplicateKey(error)) throw conflict(`Attendance already exists for ${projection.workDateKey}`);
        throw error;
      }
    }
    return records;
  });
}

async function reverseApprovedLeave(profileId, requestId, { session } = {}) {
  return runInTransaction(session, async (activeSession) => {
    const records = await repository.findByLeaveRequestId(profileId, requestId, { session: activeSession });
    const reversed = [];
    for (const record of records) {
      const remaining = (record.leaveSegments || [])
        .filter((segment) => toId(segment.requestId) !== String(requestId));
      const isPureProjection = record.source === 'LEAVE_RECONCILIATION'
        && !record.checkInAt
        && !record.checkOutAt
        && !(record.manualAdjustments || []).length;
      if (!remaining.length && isPureProjection) {
        await repository.removeById(toId(record), { session: activeSession });
        continue;
      }
      const resolved = attendanceResolution({
        existingAttendance: record,
        checkInAt: record.checkInAt ? new Date(record.checkInAt) : null,
        checkOutAt: record.checkOutAt ? new Date(record.checkOutAt) : null,
        scheduleSnapshot: { ...record.scheduleSnapshot, workDateKey: record.workDateKey },
        leaveSegments: remaining,
      });
      const updated = await repository.updateLeaveProjection(toId(record), {
        ...resolutionPatch(resolved),
        checkInAt: record.checkInAt || null,
        checkOutAt: record.checkOutAt || null,
        source: record.source,
        scheduleSnapshot: record.scheduleSnapshot,
        manualAdjustments: record.manualAdjustments || [],
        leaveSegments: remaining,
      }, { session: activeSession });
      if (!updated) throw conflict(`Attendance changed for ${record.workDateKey}`);
      reversed.push(toAttendanceDto(updated));
    }
    return reversed;
  });
}

module.exports = {
  adjustAttendance,
  checkIn,
  checkOut,
  importAttendancePunches,
  listAttendance,
  listMonthMatrix,
  reconcileApprovedLeave,
  reverseApprovedLeave,
};
