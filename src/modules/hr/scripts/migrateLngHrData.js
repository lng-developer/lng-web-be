const mongoose = require('mongoose');
const crypto = require('crypto');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const authPublic = require('../../auth/public');
const organizationPublic = require('../../organization/public');
const EmployeeProfile = require('../models/employeeProfile.model');
const LeaveBalance = require('../models/leaveBalance.model');
const LeaveRequest = require('../models/leaveRequest.model');
const OvertimeRequest = require('../models/overtimeRequest.model');
const AttendanceDaily = require('../models/attendanceDaily.model');
const WorkLocation = require('../models/workLocation.model');
const Shift = require('../models/shift.model');
const ShiftAssignment = require('../models/shiftAssignment.model');
const CalendarOverride = require('../models/calendarOverride.model');
const Holiday = require('../models/holiday.model');
const SaturdayRotation = require('../models/saturdayRotation.model');
const PayrollAdjustment = require('../models/payrollAdjustment.model');
const PayrollRun = require('../models/payrollRun.model');
const PayrollResult = require('../models/payrollResult.model');
const Announcement = require('../models/announcement.model');
const notificationPublic = require('../../notification/public');
const integrationPublic = require('../../integration/public');
const {
  hrAttendanceStatuses,
  hrCalendarOverrideKinds,
  hrEmployeeStatuses,
  hrEmploymentTypes,
  hrLeaveTypes,
  hrRequestStatuses,
  hrWorkModes,
} = require('../constants/hr.constants');

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_LOCATION_CODE = 'LNG_OFFICE';
const DEFAULT_SHIFT_CODE = 'LNG_DAY';
const LEGACY_EPOCH = new Date('1970-01-01T00:00:00.000Z');
const HR_ADMIN_OVERRIDE_PERMISSION_CODES = Object.freeze([
  'AUTH:READ',
  'AUTH:WRITE',
  'AUDIT:READ',
  'DEPARTMENTS:READ',
  'DEPARTMENTS:WRITE',
  'HR_ANNOUNCEMENTS:READ',
  'HR_ANNOUNCEMENTS:WRITE',
  'HR_ATTENDANCE:MANAGE',
  'HR_ATTENDANCE:READ',
  'HR_ATTENDANCE:WRITE',
  'HR_CALENDAR:READ',
  'HR_CALENDAR:WRITE',
  'HR_COMPENSATION:READ',
  'HR_COMPENSATION:WRITE',
  'HR_EMPLOYEES:READ',
  'HR_EMPLOYEES:WRITE',
  'HR_INTEGRATIONS:MANAGE',
  'HR_LEAVE:APPROVE',
  'HR_LEAVE:READ',
  'HR_LEAVE:WRITE',
  'HR_OVERTIME:APPROVE',
  'HR_OVERTIME:READ',
  'HR_OVERTIME:WRITE',
  'HR_PAYROLL:FINALIZE',
  'HR_PAYROLL:PAY',
  'HR_PAYROLL:READ',
  'HR_PAYROLL:WRITE',
  'HR_SCHEDULE:READ',
  'HR_SCHEDULE:WRITE',
  'REPORTS:READ',
  'TEAMS:READ',
  'TEAMS:WRITE',
]);

function parseArgs(argv = process.argv.slice(2)) {
  return {
    apply: argv.includes('--apply'),
    limit: Number(argv.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length) || 0),
    ...(argv.includes('--attendance-times-only') ? { attendanceTimesOnly: true } : {}),
  };
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function legacyAttendanceAt(date, time) {
  const workDateKey = dateKey(date);
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!workDateKey || !match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return new Date(`${workDateKey}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000+07:00`);
}

function buildAttendanceTimeBackfillOperations(sourceAttendances) {
  return sourceAttendances.flatMap((attendance) => {
    const workDateKey = dateKey(attendance.date);
    if (!attendance.employeeId || !workDateKey) return [];
    const baseFilter = { profileId: attendance.employeeId, workDateKey };
    const checkInAt = legacyAttendanceAt(attendance.date, attendance.checkIn);
    const checkOutAt = legacyAttendanceAt(attendance.date, attendance.checkOut);
    return [
      checkInAt && { updateOne: { filter: { ...baseFilter, checkInAt: null }, update: { $set: { checkInAt } } } },
      checkOutAt && { updateOne: { filter: { ...baseFilter, checkOutAt: null }, update: { $set: { checkOutAt } } } },
    ].filter(Boolean);
  });
}

function minutesOfDay(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeEmployeeStatus(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized === 'ACTIVE') return hrEmployeeStatuses.ACTIVE;
  if (normalized === 'PROBATION') return hrEmployeeStatuses.PROBATION;
  if (normalized === 'RESIGNED') return hrEmployeeStatuses.RESIGNED;
  if (normalized === 'SUSPENDED') return hrEmployeeStatuses.SUSPENDED;
  return hrEmployeeStatuses.ACTIVE;
}

function normalizeEmploymentType(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized === 'FULL_TIME') return hrEmploymentTypes.FULL_TIME;
  if (normalized === 'PART_TIME') return hrEmploymentTypes.PART_TIME;
  if (normalized === 'INTERNSHIP') return hrEmploymentTypes.INTERNSHIP;
  if (normalized === 'CONTRACT') return hrEmploymentTypes.CONTRACT;
  return hrEmploymentTypes.FULL_TIME;
}

function normalizeWorkMode(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized === 'REMOTE') return hrWorkModes.REMOTE;
  if (normalized === 'HYBRID') return hrWorkModes.HYBRID;
  return hrWorkModes.ONSITE;
}

function normalizeRequestStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (Object.values(hrRequestStatuses).includes(normalized)) return normalized;
  return hrRequestStatuses.PENDING;
}

function normalizeLeaveType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (Object.values(hrLeaveTypes).includes(normalized)) return normalized;
  return hrLeaveTypes.ANNUAL;
}

function normalizeAttendanceStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (Object.values(hrAttendanceStatuses).includes(normalized)) return normalized;
  return hrAttendanceStatuses.PRESENT;
}

function attendanceSource(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'WEB_APP') return 'SELF_SERVICE';
  if (normalized === 'MANUAL' || normalized === 'BULK_MANUAL') return 'MANAGED';
  return 'MANAGED';
}

function paidLeaveStatus(leaveType) {
  return leaveType === hrLeaveTypes.UNPAID || leaveType === hrLeaveTypes.PERSONAL_UNPAID
    ? hrAttendanceStatuses.UNPAID_LEAVE
    : hrAttendanceStatuses.PAID_LEAVE;
}

function requestedUnits(totalDays) {
  const days = Number(totalDays || 1);
  return Math.max(1, Math.round(days * 2));
}

function buildScheduleSnapshot({ assignment, departmentId, teamId, location, shift, date }) {
  const startMinute = minutesOfDay(shift.startTime, 8 * 60);
  const endMinute = minutesOfDay(shift.endTime, 17 * 60);
  const startAt = new Date(`${date}T${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')}:00.000+07:00`);
  const endAt = new Date(`${date}T${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}:00.000+07:00`);
  return {
    assignmentId: assignment?._id || null,
    departmentId: departmentId || null,
    teamId: teamId || null,
    timezone: location.timezone || DEFAULT_TIMEZONE,
    plannedStartAt: startAt,
    plannedEndAt: endAt,
    calendarStatus: 'WORKDAY',
    workLocation: {
      id: location._id,
      code: location.code,
      name: location.name,
    },
    shift: {
      id: shift._id,
      code: shift.code,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: shift.breakMinutes || 0,
      graceMinutes: shift.graceMinutes || 0,
      durationMinutes: Math.max(1, (endMinute - startMinute) - (shift.breakMinutes || 0)),
      isOvernight: endMinute <= startMinute,
    },
    calendarOverride: {
      id: null,
      kind: null,
      scopeType: null,
      scopeId: null,
      name: null,
    },
  };
}

function summarizeBulkWrite(result = {}, read = 0, { skippedRows = [], failed = 0 } = {}) {
  const inserted = Number(result.upsertedCount || 0);
  const updated = Number(result.modifiedCount || 0);
  const unchanged = Math.max(0, Number(result.matchedCount || 0) - updated);
  return {
    read,
    mapped: read,
    inserted,
    updated,
    unchanged,
    skipped: skippedRows.length,
    failed,
    skippedRows,
  };
}

function legacyFactDate(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return LEGACY_EPOCH;
}

function integer(value) {
  return Math.round(Number(value || 0));
}

function stableObjectId(value) {
  return new mongoose.Types.ObjectId(crypto.createHash('sha256').update(value).digest('hex').slice(0, 24));
}

function mapLegacyTeams(sourceTeams = [], departmentBySourceId = new Map()) {
  const skippedRows = [];
  const items = sourceTeams.flatMap((team) => {
    if (!team.departmentId || !departmentBySourceId.has(String(team.departmentId))) {
      skippedRows.push({ sourceId: String(team._id), reasonCode: 'MISSING_OR_UNMAPPED_DEPARTMENT' });
      return [];
    }
    return [{
      _id: team._id,
      name: team.name || team.teamCode || 'Team',
      code: String(team.teamCode || team.name || team._id).toUpperCase(),
      departmentId: departmentBySourceId.get(String(team.departmentId))._id,
      status: team.isActive === false ? 'inactive' : 'active',
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    }];
  });
  return { items, skippedRows };
}

function reconcileRows(sourceRows = [], mappedRows = [], skippedRows = [], reasonCode = 'NOT_MAPPED') {
  const accountedIds = new Set([
    ...mappedRows.map((row) => String(row._id || row.sourceId)),
    ...skippedRows.map((row) => String(row.sourceId)),
  ]);
  return [
    ...skippedRows,
    ...sourceRows
      .filter((row) => !accountedIds.has(String(row._id)))
      .map((row) => ({ sourceId: String(row._id), reasonCode })),
  ];
}

function assertIdentityApplyReady(apply, result = {}) {
  if (apply && (Number(result.skipped || 0) > 0 || Number(result.failed || 0) > 0)) {
    throw new Error(`Identity migration preflight failed: ${Number(result.skipped || 0)} skipped, ${Number(result.failed || 0)} failed`);
  }
}

function isActiveLegacyEmployee(employee = {}) {
  return employee.isDeleted !== true && ['ACTIVE', 'PROBATION'].includes(
    String(employee.status || '').trim().toUpperCase(),
  );
}

function normalizedEmail(...values) {
  for (const value of values) {
    const email = String(value || '').trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return email;
  }
  return null;
}

function assignment(roleCode, scopeType, scopeId = null, overridePermissionCodes = null) {
  return { roleCode, scopeType, scopeId, overridePermissionCodes };
}

function roleDecision(legacyRole, employee) {
  const departmentId = employee.departmentId ? String(employee.departmentId) : null;
  const teamId = employee.teamId ? String(employee.teamId) : null;
  switch (legacyRole) {
    case 'ADMIN':
      return { legacyRole, assignments: [assignment('ADMIN', 'global')], elevated: true };
    case 'DIRECTOR':
    case 'HR':
      return {
        legacyRole,
        assignments: [assignment('MANAGER', 'global', null, [...HR_ADMIN_OVERRIDE_PERMISSION_CODES])],
        elevated: false,
      };
    case 'MANAGER':
      if (!departmentId) return null;
      return {
        legacyRole,
        assignments: [
          assignment('MANAGER', 'department', departmentId),
          assignment('USER', teamId ? 'team' : 'own', teamId),
        ],
        elevated: false,
      };
    case 'LEADER':
      if (!teamId) return null;
      return {
        legacyRole,
        assignments: [
          assignment('LEADER', 'team', teamId),
          assignment('USER', 'team', teamId),
        ],
        elevated: false,
      };
    case 'EMPLOYEE':
      return {
        legacyRole,
        assignments: [assignment('USER', teamId ? 'team' : 'own', teamId)],
        elevated: false,
      };
    default:
      return undefined;
  }
}

function planLegacyIdentities({
  sourceAccounts = [],
  sourceRoles = [],
  sourceEmployees = [],
  sourceTeams = [],
  targetAccounts = [],
  departmentBySourceId = new Map(),
  teamBySourceId = new Map(),
} = {}) {
  const accountById = new Map(sourceAccounts.map((account) => [String(account._id), account]));
  const roleById = new Map(sourceRoles.map((role) => [String(role._id), String(role.name || '').trim().toUpperCase()]));
  const teamById = new Map(sourceTeams.map((team) => [String(team._id), team]));
  const targetByEmail = new Map(targetAccounts.flatMap((account) => [
    [String(account.email || '').trim().toLowerCase(), account],
    [String(account.normalizedEmail || '').trim().toLowerCase(), account],
  ]).filter(([email]) => email));
  const targetByEmployeeCode = new Map(targetAccounts
    .filter((account) => account.employeeCode)
    .map((account) => [String(account.employeeCode).trim().toUpperCase(), account]));
  const skippedRows = [];
  const items = sourceEmployees.flatMap((employee) => {
    const sourceAccountId = String(employee.accountId || '');
    const sourceAccount = accountById.get(sourceAccountId);
    if (!sourceAccount) {
      skippedRows.push({ sourceId: String(employee._id), sourceAccountId, legacyRole: null, reasonCode: 'SOURCE_ACCOUNT_NOT_FOUND' });
      return [];
    }
    const legacyRole = roleById.get(String(sourceAccount.role)) || null;
    const departmentId = departmentBySourceId.get(String(employee.departmentId))?._id
      ? String(departmentBySourceId.get(String(employee.departmentId))._id)
      : null;
    const teamId = teamBySourceId.get(String(employee.teamId))?._id
      ? String(teamBySourceId.get(String(employee.teamId))._id)
      : null;
    const decision = roleDecision(legacyRole, { ...employee, departmentId, teamId });
    if (decision === undefined) {
      skippedRows.push({ sourceId: String(employee._id), sourceAccountId, legacyRole, reasonCode: 'UNMAPPED_LEGACY_ROLE' });
      return [];
    }
    if (decision === null) {
      skippedRows.push({ sourceId: String(employee._id), sourceAccountId, legacyRole, reasonCode: 'MISSING_ROLE_SCOPE' });
      return [];
    }
    const sourceEmail = normalizedEmail(employee.workEmail, employee.personalEmail);
    if (!sourceEmail) {
      skippedRows.push({ sourceId: String(employee._id), sourceAccountId, legacyRole, reasonCode: 'VALID_EMAIL_NOT_FOUND' });
      return [];
    }
    const targetBySourceEmail = targetByEmail.get(sourceEmail);
    const targetByCode = targetByEmployeeCode.get(String(employee.employeeCode || '').trim().toUpperCase());
    if (targetBySourceEmail && targetByCode && String(targetBySourceEmail._id) !== String(targetByCode._id)) {
      skippedRows.push({ sourceId: String(employee._id), sourceAccountId, legacyRole, reasonCode: 'AMBIGUOUS_TARGET_ACCOUNT' });
      return [];
    }
    const targetAccount = targetBySourceEmail || targetByCode;
    const email = targetAccount
      ? normalizedEmail(targetAccount.normalizedEmail, targetAccount.email)
      : sourceEmail;
    const sourceTeam = teamById.get(String(employee.teamId));
    return [{
      sourceId: String(employee._id),
      sourceAccountId,
      accountId: String(targetAccount?._id || sourceAccount._id),
      email,
      accountStatus: targetAccount?.status || 'inactive',
      fullName: employee.fullName || employee.employeeCode || email,
      employeeCode: employee.employeeCode || null,
      phone: employee.phoneNumber || null,
      avatarUrl: employee.avatar || null,
      personalEmail: employee.personalEmail || null,
      dateOfBirth: employee.birthDate || null,
      gender: employee.gender || null,
      address: employee.address || null,
      departmentId,
      teamId,
      memberType: sourceTeam && String(sourceTeam.leader || '') === String(employee._id) ? 'LEADER' : 'MEMBER',
      roleDecision: decision,
      isActiveOrProbation: isActiveLegacyEmployee(employee),
    }];
  });
  const activeOrProbationRead = sourceEmployees.filter(isActiveLegacyEmployee).length;
  const activeOrProbationMapped = items.filter((item) => item.isActiveOrProbation).length;
  return {
    items,
    skippedRows,
    summary: {
      read: sourceEmployees.length,
      mapped: items.length,
      skipped: skippedRows.length,
      activeOrProbationRead,
      activeOrProbationMapped,
      activeOrProbationSkipped: activeOrProbationRead - activeOrProbationMapped,
    },
  };
}

async function upsertMany(Model, docs, buildFilter, apply, { read = docs.length, skippedRows = [] } = {}) {
  if (!docs.length || !apply) return { ...summarizeBulkWrite({}, docs.length, { skippedRows }), read };
  try {
    const result = await Model.bulkWrite(docs.map((doc) => ({
      updateOne: {
        filter: buildFilter(doc),
        update: {
          $set: Object.fromEntries(Object.entries(doc).filter(([key]) => key !== '_id')),
          ...(doc._id ? { $setOnInsert: { _id: doc._id } } : {}),
        },
        upsert: true,
      },
    })), { ordered: false });
    return { ...summarizeBulkWrite(result, docs.length, { skippedRows }), read };
  } catch (error) {
    const failed = error.writeErrors?.length || docs.length;
    return { ...summarizeBulkWrite({}, docs.length, { skippedRows, failed }), read };
  }
}

async function connectSource() {
  if (!process.env.SOURCE_MONGODB_URI) {
    throw new Error('SOURCE_MONGODB_URI is required');
  }
  const connection = await mongoose.createConnection(process.env.SOURCE_MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  }).asPromise();
  return connection;
}

async function backfillLngHrAttendanceTimes(options = {}) {
  const apply = Boolean(options.apply);
  const limit = Number(options.limit || 0);
  const source = await connectSource();
  await connectDatabase();

  try {
    const sourceDb = source.db.databaseName;
    const targetDb = mongoose.connection.db.databaseName;
    if (sourceDb === targetDb) throw new Error('Source and target database must be different');
    const sourceAttendances = await source.db.collection('attendances').find({}, limit > 0 ? { limit } : {}).toArray();
    const operations = buildAttendanceTimeBackfillOperations(sourceAttendances);
    const result = apply && operations.length
      ? await AttendanceDaily.bulkWrite(operations, { ordered: false })
      : {};
    return {
      mode: apply ? 'apply' : 'dry-run',
      sourceDb,
      targetDb,
      attendanceTimes: {
        read: sourceAttendances.length,
        mapped: operations.length,
        matched: result.matchedCount || 0,
        updated: result.modifiedCount || 0,
      },
    };
  } finally {
    await source.close();
    await disconnectDatabase();
  }
}

async function migrateLngHrData(options = {}) {
  if (options.attendanceTimesOnly) return backfillLngHrAttendanceTimes(options);
  const apply = Boolean(options.apply);
  const limit = Number(options.limit || 0);
  const source = await connectSource();
  await connectDatabase();

  try {
    const src = source.db;
    const sourceDb = src.databaseName;
    const targetDb = mongoose.connection.db.databaseName;
    if (sourceDb === targetDb) throw new Error('Source and target database must be different');

    const slice = limit > 0 ? { limit } : {};
    const [
      sourceAccounts,
      sourceRoles,
      sourceDepartments,
      sourceTeams,
      sourceEmployees,
      sourceShifts,
      sourceHolidays,
      sourceRotations,
      sourcePayrollAdjustments,
      sourcePayrolls,
      sourceAnnouncements,
      sourceNotifications,
      sourceSyncLogs,
    ] = await Promise.all([
      src.collection('accounts').find({}).toArray(),
      src.collection('roles').find({}).toArray(),
      src.collection('departments').find({}).toArray(),
      src.collection('teams').find({}).toArray(),
      src.collection('employees').find({}, slice).toArray(),
      src.collection('shifts').find({}).toArray(),
      src.collection('holidays').find({}).toArray(),
      src.collection('saturdayrotations').find({}, slice).toArray(),
      src.collection('payrolladjustments').find({}, slice).toArray(),
      src.collection('payrolls').find({}, slice).toArray(),
      src.collection('announcements').find({}, slice).toArray(),
      src.collection('notifications').find({}, slice).toArray(),
      src.collection('attendancesynclogs').find({ status: 'SUCCESS' }).sort({ finishedAt: -1, _id: -1 }).limit(1).toArray(),
    ]);

    const targetAccounts = await authPublic.listMigrationAccounts();

    const plannedDepartments = sourceDepartments.map((department) => ({
      _id: department._id,
      name: department.name || department.deptCode || 'Department',
      code: String(department.deptCode || department.name || department._id).toUpperCase(),
      status: department.isActive === false ? 'inactive' : 'active',
      createdAt: department.createdAt,
      updatedAt: department.updatedAt,
    }));
    const departmentResolution = await organizationPublic.resolveLegacyDepartments(plannedDepartments);
    const departments = departmentResolution.items;
    const departmentByTargetId = new Map(departments.map((department) => [String(department._id), department]));
    const departmentBySourceId = new Map(departmentResolution.mappings.map((mapping) => [
      mapping.sourceId,
      departmentByTargetId.get(mapping.targetId),
    ]));

    const { items: plannedTeams, skippedRows: skippedTeams } = mapLegacyTeams(sourceTeams, departmentBySourceId);
    const teamResolution = await organizationPublic.resolveLegacyTeams(plannedTeams);
    const teams = teamResolution.items;
    const teamByTargetId = new Map(teams.map((team) => [String(team._id), team]));
    const teamBySourceId = new Map(teamResolution.mappings.map((mapping) => [
      mapping.sourceId,
      teamByTargetId.get(mapping.targetId),
    ]));
    const organizationSkippedRows = [
      ...departmentResolution.skippedRows,
      ...skippedTeams,
      ...teamResolution.skippedRows,
    ];
    if (apply && organizationSkippedRows.length > 0) {
      throw new Error(`Organization migration preflight failed: ${organizationSkippedRows.length} skipped`);
    }

    const identityPlan = planLegacyIdentities({
      sourceAccounts,
      sourceRoles,
      sourceEmployees,
      sourceTeams,
      targetAccounts,
      departmentBySourceId,
      teamBySourceId,
    });
    const identityPreflight = await authPublic.migrateLegacyIdentities(identityPlan.items, { apply: false });
    assertIdentityApplyReady(apply, {
      skipped: identityPlan.skippedRows.length + identityPreflight.skippedRows.length,
      failed: identityPreflight.failed,
    });
    const departmentWrite = await organizationPublic.migrateLegacyDepartments(departments, { apply });
    const departmentResult = {
      read: sourceDepartments.length,
      mapped: departments.length,
      skipped: departmentResolution.skippedRows.length,
      skippedRows: departmentResolution.skippedRows,
      ...departmentWrite,
    };
    const teamWrite = await organizationPublic.migrateLegacyTeams(teams, { apply });
    const reconciledTeamSkips = [...skippedTeams, ...teamResolution.skippedRows];
    const teamResult = { read: sourceTeams.length, mapped: teams.length, skipped: reconciledTeamSkips.length, skippedRows: reconciledTeamSkips, ...teamWrite };
    const identityWrite = apply
      ? await authPublic.migrateLegacyIdentities(identityPlan.items, { apply: true })
      : identityPreflight;
    const identitySkippedRows = [...identityPlan.skippedRows, ...identityWrite.skippedRows];
    const identityResult = {
      ...identityPlan.summary,
      ...identityWrite,
      read: sourceEmployees.length,
      mapped: identityWrite.items.length,
      skipped: identitySkippedRows.length,
      skippedRows: identitySkippedRows,
      activeOrProbationMapped: identityWrite.items.filter((result) => (
        identityPlan.items.find((item) => item.sourceId === result.sourceId)?.isActiveOrProbation
      )).length,
    };
    identityResult.activeOrProbationSkipped = identityResult.activeOrProbationRead - identityResult.activeOrProbationMapped;
    const plannedIdentityBySourceId = new Map(identityPlan.items.map((item) => [item.sourceId, item]));
    const migratedIdentityBySourceId = new Map(identityWrite.items.map((item) => [item.sourceId, item]));
    const accountIdBySourceId = new Map(identityWrite.items.map((item) => [item.sourceAccountId, item.accountId]));

    const skippedMemberships = [];
    const memberships = sourceEmployees.flatMap((employee) => {
      const sourceId = String(employee._id);
      const result = migratedIdentityBySourceId.get(sourceId);
      const planned = plannedIdentityBySourceId.get(sourceId);
      if (!result || !planned) {
        skippedMemberships.push({ sourceId, reasonCode: 'IDENTITY_NOT_MAPPED' });
        return [];
      }
      if (!planned.isActiveOrProbation) {
        skippedMemberships.push({ sourceId, reasonCode: 'INACTIVE_EMPLOYEE_NO_ACTIVE_MEMBERSHIP' });
        return [];
      }
      if (!planned.teamId) {
        skippedMemberships.push({ sourceId, reasonCode: 'TEAM_NOT_MAPPED' });
        return [];
      }
      return [{
        sourceId,
        accountId: result.accountId,
        teamId: planned.teamId,
        memberType: String(planned.memberType || 'MEMBER').toLowerCase(),
        status: planned.isActiveOrProbation ? 'active' : 'inactive',
      }];
    });
    const membershipWrite = await organizationPublic.migrateLegacyMemberships(memberships, { apply });
    const membershipSkippedRows = [...skippedMemberships, ...(membershipWrite.skippedRows || [])];
    const membershipResult = {
      ...membershipWrite,
      read: sourceEmployees.length,
      mapped: memberships.length - Number(membershipWrite.failed || 0),
      skipped: membershipSkippedRows.length,
      skippedRows: membershipSkippedRows,
    };

    const location = {
      _id: new mongoose.Types.ObjectId('00000000000000000000a001'),
      code: DEFAULT_LOCATION_CODE,
      name: 'LNG Office',
      timezone: DEFAULT_TIMEZONE,
      status: hrEmployeeStatuses.ACTIVE,
    };
    const locationResult = await upsertMany(WorkLocation, [location], (doc) => ({ code: doc.code }), apply);

    const shifts = sourceShifts.map((shift) => ({
      _id: shift._id,
      code: String(shift.shiftCode || shift.name || shift._id).toUpperCase(),
      name: shift.name || shift.shiftCode || 'Shift',
      workLocationId: location._id,
      startTime: shift.startTime || '08:00',
      endTime: shift.endTime || '17:00',
      breakMinutes: Number(shift.breakMinutes || 60),
      graceMinutes: 0,
      workdays: [1, 2, 3, 4, 5, 6],
      status: shift.isActive === false ? hrEmployeeStatuses.SUSPENDED : hrEmployeeStatuses.ACTIVE,
      createdAt: shift.createdAt,
      updatedAt: shift.updatedAt,
    }));
    if (!shifts.length) {
      shifts.push({
        _id: new mongoose.Types.ObjectId('00000000000000000000a002'),
        code: DEFAULT_SHIFT_CODE,
        name: 'LNG Day Shift',
        workLocationId: location._id,
        startTime: '08:00',
        endTime: '17:00',
        breakMinutes: 60,
        graceMinutes: 0,
        workdays: [1, 2, 3, 4, 5, 6],
        status: hrEmployeeStatuses.ACTIVE,
      });
    }
    const shiftResult = await upsertMany(Shift, shifts, (doc) => ({ code: doc.code }), apply);
    const fallbackShift = shifts[0];
    const shiftBySourceId = new Map(shifts.map((shift) => [String(shift._id), shift]));

    const skippedProfiles = [...identitySkippedRows];
    const profiles = sourceEmployees.flatMap((employee) => {
      const migratedIdentity = migratedIdentityBySourceId.get(String(employee._id));
      const plannedIdentity = plannedIdentityBySourceId.get(String(employee._id));
      if (!migratedIdentity || !plannedIdentity) {
        return [];
      }
      return [{
        _id: employee._id,
        accountId: migratedIdentity.accountId,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        gender: employee.gender || null,
        birthDate: employee.birthDate || null,
        phoneNumber: employee.phoneNumber || null,
        address: employee.address || null,
        avatarUrl: employee.avatar || null,
        personalEmail: employee.personalEmail || null,
        workEmail: employee.workEmail || plannedIdentity.email,
        emergencyContact: employee.emergencyContact || {},
        departmentId: departmentBySourceId.get(String(employee.departmentId))?._id || null,
        teamId: teamBySourceId.get(String(employee.teamId))?._id || null,
        jobTitle: null,
        jobLevel: null,
        employmentType: normalizeEmploymentType(employee.employmentType),
        workMode: normalizeWorkMode(employee.workMode),
        startDate: legacyFactDate(employee.startDate, employee.createdAt),
        status: normalizeEmployeeStatus(employee.status),
        dependantDetails: employee.dependantDetails || [],
        dependants: Number(employee.dependants || 0),
        baseSalary: Number(employee.baseSalary || 0),
        baseCurrency: employee.baseCurrency || 'VND',
        allowances: employee.allowances || {},
        responsibilityAllowance: Number(employee.responsibilityAllowance || 0),
        isProfileUpdated: Boolean(employee.isProfileUpdated),
        isDeleted: Boolean(employee.isDeleted),
        deletedAt: employee.deletedAt || null,
        createdAt: employee.createdAt,
        updatedAt: employee.updatedAt,
      }];
    });
    const profileResult = await upsertMany(EmployeeProfile, profiles, (doc) => ({ _id: doc._id }), apply, {
      read: sourceEmployees.length, skippedRows: skippedProfiles,
    });
    const profileBySourceId = new Map(profiles.map((profile) => [String(profile._id), profile]));

    const assignments = profiles.map((profile) => ({
      _id: new mongoose.Types.ObjectId(),
      profileId: profile._id,
      shiftId: fallbackShift._id,
      workLocationId: location._id,
      effectiveFrom: dateKey(profile.startDate) || '2026-01-01',
      effectiveTo: null,
      status: hrEmployeeStatuses.ACTIVE,
      createdBy: { accountId: profile.accountId, fullName: profile.fullName },
    }));
    const assignmentResult = await upsertMany(
      ShiftAssignment,
      assignments,
      (doc) => ({ profileId: doc.profileId, shiftId: doc.shiftId, effectiveFrom: doc.effectiveFrom }),
      apply,
    );
    const assignmentByProfileId = new Map(assignments.map((assignment) => [String(assignment.profileId), assignment]));

    const sourceBalances = await src.collection('leavebalances').find({}, slice).toArray();
    const leaveBalances = sourceBalances.flatMap((balance) => {
      const profile = profileBySourceId.get(String(balance.employeeId));
      if (!profile) return [];
      return [{
        _id: balance._id,
        profileId: profile._id,
        year: Number(balance.year),
        leaveType: hrLeaveTypes.ANNUAL,
        entitledUnits: Math.max(0, Math.round(Number(balance.totalAccrued || balance.currentBalance || 0) * 2)),
        adjustmentUnits: Math.round(Number(balance.carriedOver || 0) * 2),
        usedUnits: Math.max(0, Math.round(Number(balance.totalUsed || 0) * 2)),
        history: [],
        createdAt: balance.createdAt,
        updatedAt: balance.updatedAt,
      }];
    });
    const skippedBalances = reconcileRows(sourceBalances, leaveBalances, [], 'EMPLOYEE_PROFILE_NOT_MAPPED');
    const balanceResult = await upsertMany(
      LeaveBalance,
      leaveBalances,
      (doc) => ({ profileId: doc.profileId, year: doc.year, leaveType: doc.leaveType }),
      apply,
      { read: sourceBalances.length, skippedRows: skippedBalances },
    );

    const calendarOverrides = sourceHolidays.flatMap((holiday) => {
      const key = dateKey(holiday.date);
      if (!key) return [];
      return [{
        _id: holiday._id,
        dateKey: key,
        kind: holiday.isWorkDay ? hrCalendarOverrideKinds.WORKING_DAY : hrCalendarOverrideKinds.HOLIDAY,
        scopeType: 'GLOBAL',
        scopeId: null,
        name: holiday.name || 'Holiday',
        status: holiday.isActive === false ? hrEmployeeStatuses.SUSPENDED : hrEmployeeStatuses.ACTIVE,
        createdBy: { accountId: null, fullName: null },
        createdAt: holiday.createdAt,
        updatedAt: holiday.updatedAt,
      }];
    });
    const skippedCalendarOverrides = reconcileRows(sourceHolidays, calendarOverrides, [], 'INVALID_DATE');
    const calendarResult = await upsertMany(
      CalendarOverride,
      calendarOverrides,
      (doc) => ({ dateKey: doc.dateKey, scopeType: doc.scopeType, scopeId: doc.scopeId }),
      apply,
      { read: sourceHolidays.length, skippedRows: skippedCalendarOverrides },
    );

    const skippedHolidays = [];
    const holidays = sourceHolidays.flatMap((holiday) => {
      const dateKeyValue = dateKey(holiday.date);
      if (!dateKeyValue) {
        skippedHolidays.push({ sourceId: String(holiday._id), reasonCode: 'INVALID_DATE' });
        return [];
      }
      return [{
        _id: holiday._id,
        name: holiday.name || 'Holiday',
        dateKey: dateKeyValue,
        isWorkDay: Boolean(holiday.isWorkDay),
        holidayType: holiday.isWorkDay ? 'SUBSTITUTE_WORK_DAY' : 'PUBLIC_HOLIDAY',
        appliedDepartmentIds: (holiday.appliedDepartments || [])
          .map((id) => departmentBySourceId.get(String(id))?._id)
          .filter(Boolean),
        appliedTeamIds: [],
        note: holiday.note || null,
        isActive: holiday.isActive !== false,
        createdAt: holiday.createdAt,
        updatedAt: holiday.updatedAt,
      }];
    });
    const reconciledHolidays = reconcileRows(sourceHolidays, holidays, skippedHolidays, 'HOLIDAY_NOT_MAPPED');
    const holidayResult = await upsertMany(Holiday, holidays, (doc) => ({ dateKey: doc.dateKey }), apply, {
      read: sourceHolidays.length, skippedRows: reconciledHolidays,
    });

    const skippedRotations = [];
    const rotations = sourceRotations.flatMap((rotation) => {
      const workDateKey = dateKey(rotation.date);
      if (!workDateKey || !teamBySourceId.has(String(rotation.teamId))) {
        skippedRotations.push({ sourceId: String(rotation._id), reasonCode: !workDateKey ? 'INVALID_DATE' : 'TEAM_NOT_MAPPED' });
        return [];
      }
      const employeeProfileIds = (rotation.employeesOff || []).map((id) => profileBySourceId.get(String(id))?._id).filter(Boolean);
      return [{
        _id: rotation._id,
        teamId: teamBySourceId.get(String(rotation.teamId))._id,
        workDateKey,
        month: Number(rotation.month),
        year: Number(rotation.year),
        employeeProfileIds,
        minPresent: Math.max(0, Number(rotation.minPresent || 0)),
        source: 'GENERATED',
        createdAt: rotation.createdAt,
        updatedAt: rotation.updatedAt,
      }];
    });
    const reconciledRotations = reconcileRows(sourceRotations, rotations, skippedRotations, 'ROTATION_NOT_MAPPED');
    const rotationResult = await upsertMany(SaturdayRotation, rotations, (doc) => ({ teamId: doc.teamId, workDateKey: doc.workDateKey }), apply, {
      read: sourceRotations.length, skippedRows: reconciledRotations,
    });

    const sourceLeaves = await src.collection('leaves').find({}, slice).toArray();
    const leaveRequests = sourceLeaves.flatMap((leave) => {
      const profile = profileBySourceId.get(String(leave.employeeId));
      if (!profile) return [];
      const startDateKey = dateKey(leave.fromDate);
      const endDateKey = dateKey(leave.toDate || leave.fromDate);
      if (!startDateKey || !endDateKey) return [];
      const leaveType = normalizeLeaveType(leave.leaveType);
      const units = requestedUnits(leave.totalDays);
      const scheduleSnapshot = buildScheduleSnapshot({
        assignment: assignmentByProfileId.get(String(profile._id)),
        departmentId: profile.departmentId,
        teamId: profile.teamId,
        location,
        shift: fallbackShift,
        date: startDateKey,
      });
      return [{
        _id: leave._id,
        profileId: profile._id,
        accountId: profile.accountId,
        year: Number(startDateKey.slice(0, 4)),
        leaveType,
        attendanceStatus: paidLeaveStatus(leaveType),
        portion: 'FULL_DAY',
        startDateKey,
        endDateKey,
        workingDateKeys: [startDateKey],
        conflictKeys: [startDateKey],
        workingDateSnapshots: [{ dateKey: startDateKey, units, scheduleSnapshot }],
        requestedUnits: units,
        requesterSnapshot: {
          accountId: profile.accountId,
          profileId: profile._id,
          employeeCode: profile.employeeCode,
          fullName: profile.fullName,
          departmentId: profile.departmentId,
          teamId: profile.teamId,
        },
        reason: leave.reason || 'Migrated from lng_hr',
        status: normalizeRequestStatus(leave.status),
        decision: leave.approvedAt ? {
          actorId: profile.accountId,
          actorName: null,
          reason: null,
          occurredAt: leave.approvedAt,
        } : null,
        cancellation: null,
        createdAt: leave.createdAt,
        updatedAt: leave.updatedAt,
      }];
    });
    const skippedLeaves = reconcileRows(sourceLeaves, leaveRequests, [], 'EMPLOYEE_PROFILE_OR_DATE_NOT_MAPPED');
    const leaveResult = await upsertMany(LeaveRequest, leaveRequests, (doc) => ({ _id: doc._id }), apply, {
      read: sourceLeaves.length, skippedRows: skippedLeaves,
    });

    const sourceOvertimes = await src.collection('overtimes').find({}, slice).toArray();
    const activeOvertimeKeys = new Set();
    const skippedOvertimes = [];
    const overtimeRequests = sourceOvertimes.flatMap((overtime) => {
      const profile = profileBySourceId.get(String(overtime.employeeId));
      const workDateKey = dateKey(overtime.date);
      if (!profile || !workDateKey) return [];
      const startMinute = minutesOfDay(overtime.startTime, 18 * 60);
      const endMinute = minutesOfDay(overtime.endTime, startMinute + 60);
      const minutes = Math.max(30, Math.round(Number(overtime.totalHours || overtime.approvedHours || 1) * 60));
      const status = normalizeRequestStatus(overtime.status);
      const activeConflictKey = `${profile._id}:${startMinute}`;
      if (
        [hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED].includes(status)
        && activeOvertimeKeys.has(activeConflictKey)
      ) {
        skippedOvertimes.push({ sourceId: String(overtime._id), reasonCode: 'DUPLICATE_ACTIVE_CONFLICT_MINUTE' });
        return [];
      }
      if ([hrRequestStatuses.PENDING, hrRequestStatuses.APPROVED].includes(status)) {
        activeOvertimeKeys.add(activeConflictKey);
      }
      return [{
        _id: overtime._id,
        profileId: profile._id,
        accountId: profile.accountId,
        workDateKey,
        plannedStartTime: overtime.startTime || '18:00',
        plannedEndTime: overtime.endTime || '19:00',
        plannedStartAt: new Date(`${workDateKey}T${overtime.startTime || '18:00'}:00.000+07:00`),
        plannedEndAt: new Date(`${workDateKey}T${overtime.endTime || '19:00'}:00.000+07:00`),
        startMinute,
        endMinute: Math.max(startMinute + 30, endMinute),
        requestedMinutes: Math.min(960, minutes),
        approvedMinutes: normalizeRequestStatus(overtime.status) === hrRequestStatuses.APPROVED ? Math.min(960, minutes) : null,
        calendarClass: overtime.otType === 'HOLIDAY' ? 'HOLIDAY' : overtime.otType === 'WEEKEND' ? 'REST_DAY' : 'WORKDAY',
        conflictMinuteKeys: [startMinute],
        requesterSnapshot: {
          accountId: profile.accountId,
          profileId: profile._id,
          employeeCode: profile.employeeCode,
          fullName: profile.fullName,
          departmentId: profile.departmentId,
          teamId: profile.teamId,
        },
        scheduleSnapshot: buildScheduleSnapshot({
          assignment: assignmentByProfileId.get(String(profile._id)),
          departmentId: profile.departmentId,
          teamId: profile.teamId,
          location,
          shift: fallbackShift,
          date: workDateKey,
        }),
        reason: overtime.reason || 'Migrated from lng_hr',
        status,
        decision: overtime.approvedAt ? {
          actorId: profile.accountId,
          actorName: null,
          reason: null,
          occurredAt: overtime.approvedAt,
        } : null,
        cancellation: null,
        createdAt: overtime.createdAt,
        updatedAt: overtime.updatedAt,
      }];
    });
    const reconciledOvertimes = reconcileRows(sourceOvertimes, overtimeRequests, skippedOvertimes, 'EMPLOYEE_PROFILE_OR_DATE_NOT_MAPPED');
    const overtimeResult = await upsertMany(OvertimeRequest, overtimeRequests, (doc) => ({ _id: doc._id }), apply, {
      read: sourceOvertimes.length, skippedRows: reconciledOvertimes,
    });

    const sourceAttendances = await src.collection('attendances').find({}, slice).toArray();
    const attendances = sourceAttendances.flatMap((attendance) => {
      const profile = profileBySourceId.get(String(attendance.employeeId));
      const workDateKey = dateKey(attendance.date);
      if (!profile || !workDateKey) return [];
      return [{
        _id: attendance._id,
        profileId: profile._id,
        workDateKey,
        status: normalizeAttendanceStatus(attendance.status),
        workDayValue: Math.max(0, Math.min(1, Number(attendance.workDayValue || 0))),
        calculationReason: attendance.calculationReason || null,
        checkInAt: legacyAttendanceAt(attendance.date, attendance.checkIn),
        checkOutAt: legacyAttendanceAt(attendance.date, attendance.checkOut),
        lateMinutes: Math.max(0, Number(attendance.lateMinutes || 0)),
        earlyLeaveMinutes: Math.max(0, Number(attendance.earlyMinutes || 0)),
        workedMinutes: Math.round(Number(attendance.workDayValue || 0) * 8 * 60),
        source: attendanceSource(attendance.source),
        isManualEdited: Boolean(attendance.isManualEdited),
        sourceBatchIds: [],
        scheduleSnapshot: buildScheduleSnapshot({
          assignment: assignmentByProfileId.get(String(profile._id)),
          departmentId: profile.departmentId,
          teamId: profile.teamId,
          location,
          shift: shiftBySourceId.get(String(attendance.shiftId)) || fallbackShift,
          date: workDateKey,
        }),
        leaveSegments: [],
        manualAdjustments: [],
        createdAt: attendance.createdAt,
        updatedAt: attendance.updatedAt,
      }];
    });
    const skippedAttendances = reconcileRows(sourceAttendances, attendances, [], 'EMPLOYEE_PROFILE_OR_DATE_NOT_MAPPED');
    const attendanceResult = await upsertMany(AttendanceDaily, attendances, (doc) => ({
      profileId: doc.profileId,
      workDateKey: doc.workDateKey,
    }), apply, { read: sourceAttendances.length, skippedRows: skippedAttendances });

    const skippedAdjustments = [];
    const adjustments = sourcePayrollAdjustments.flatMap((adjustment) => {
      const profile = profileBySourceId.get(String(adjustment.employeeId));
      if (!profile) {
        skippedAdjustments.push({ sourceId: String(adjustment._id), reasonCode: 'PROFILE_NOT_MAPPED' });
        return [];
      }
      const actorId = accountIdBySourceId.get(String(adjustment.updatedBy || adjustment.createdBy)) || profile.accountId;
      return [{
        _id: adjustment._id,
        profileId: profile._id,
        month: Number(adjustment.month),
        year: Number(adjustment.year),
        type: ['EARNING', 'ALLOWANCE', 'DEDUCTION'].includes(adjustment.type) ? adjustment.type : 'EARNING',
        code: ['BONUS', 'PENALTY', 'ADVANCE', 'ARREARS', 'OTHER'].includes(adjustment.code) ? adjustment.code : 'OTHER',
        name: adjustment.name || 'Migrated adjustment',
        amount: Math.max(0, integer(adjustment.amount)),
        note: adjustment.note || null,
        status: adjustment.status === 'CANCELLED' ? 'CANCELLED' : 'APPROVED',
        createdByAccountId: accountIdBySourceId.get(String(adjustment.createdBy)) || profile.accountId,
        updatedByAccountId: actorId,
        createdAt: adjustment.createdAt,
        updatedAt: adjustment.updatedAt,
      }];
    });
    const reconciledAdjustments = reconcileRows(sourcePayrollAdjustments, adjustments, skippedAdjustments, 'PAYROLL_ADJUSTMENT_NOT_MAPPED');
    const adjustmentResult = await upsertMany(PayrollAdjustment, adjustments, (doc) => ({ _id: doc._id }), apply, {
      read: sourcePayrollAdjustments.length, skippedRows: reconciledAdjustments,
    });

    const skippedPayrolls = [];
    const payrollRows = sourcePayrolls.flatMap((payroll) => {
      const profile = profileBySourceId.get(String(payroll.employeeId));
      if (!profile || !Number.isInteger(Number(payroll.month)) || !Number.isInteger(Number(payroll.year))) {
        skippedPayrolls.push({ sourceId: String(payroll._id), reasonCode: profile ? 'INVALID_PERIOD' : 'PROFILE_NOT_MAPPED' });
        return [];
      }
      return [{ payroll, profile }];
    });
    const payrollRunByPeriod = new Map();
    for (const { payroll, profile } of payrollRows) {
      const key = `${payroll.year}-${payroll.month}`;
      if (!payrollRunByPeriod.has(key)) payrollRunByPeriod.set(key, {
        _id: stableObjectId(`lng-hr-payroll-run:${key}`), month: Number(payroll.month), year: Number(payroll.year),
        formulaVersion: 'LEGACY_MIGRATION_V1', status: payroll.status || 'DRAFT', version: 0,
        resultCount: 0, createdByAccountId: profile.accountId, finalizedByAccountId: null,
        finalizedAt: null, paidAt: null,
      });
      payrollRunByPeriod.get(key).resultCount += 1;
    }
    const payrollRuns = [...payrollRunByPeriod.values()];
    const payrollRunResult = await upsertMany(PayrollRun, payrollRuns, (doc) => ({ month: doc.month, year: doc.year }), apply, {
      read: payrollRuns.length,
    });
    const payrollResults = payrollRows.map(({ payroll, profile }) => {
      const run = payrollRunByPeriod.get(`${payroll.year}-${payroll.month}`);
      const insurance = {
        social: integer(payroll.insurance?.bhxh), health: integer(payroll.insurance?.bhyt),
        unemployment: integer(payroll.insurance?.bhtn), total: integer(payroll.insurance?.total),
      };
      return {
        _id: payroll._id, payrollRunId: run._id, profileId: profile._id, accountId: profile.accountId,
        employeeSnapshot: { employeeCode: payroll.employeeCodeSnapshot || profile.employeeCode, fullName: payroll.employeeNameSnapshot || profile.fullName, departmentId: profile.departmentId, teamId: profile.teamId },
        formulaVersion: 'LEGACY_MIGRATION_V1', inputSnapshot: { migratedFromPayrollId: String(payroll._id) },
        standardWorkDays: Math.max(1, integer(payroll.standardWorkDays || 1)), workUnits: Math.max(0, integer((payroll.actualWorkDays || 0) * 2)),
        salaryFromWork: integer(payroll.salaryFromWork), overtimePay: integer(payroll.otPay), overtimeBreakdown: [],
        totalAllowances: integer(payroll.totalAllowance), allowanceBreakdown: payroll.allowanceBreakdown || {},
        adjustmentEarnings: integer(payroll.totalAdjustmentEarnings), adjustmentDeductions: integer(payroll.totalAdjustmentDeductions),
        grossIncome: integer(payroll.grossIncome), insurance, personalIncomeTax: integer(payroll.pit),
        totalDeductions: integer(payroll.totalDeduction), netIncome: integer(payroll.netIncome),
        status: ['DRAFT', 'FINALIZED', 'PAID'].includes(payroll.status) ? payroll.status : 'DRAFT', version: 0,
        finalizedAt: payroll.status === 'FINALIZED' || payroll.status === 'PAID' ? payroll.updatedAt || payroll.createdAt : null,
        paidAt: payroll.status === 'PAID' ? payroll.updatedAt || payroll.createdAt : null,
        paidByAccountId: null, createdAt: payroll.createdAt, updatedAt: payroll.updatedAt,
      };
    });
    const reconciledPayrolls = reconcileRows(sourcePayrolls, payrollResults, skippedPayrolls, 'PAYROLL_NOT_MAPPED');
    const payrollResult = await upsertMany(PayrollResult, payrollResults, (doc) => ({ payrollRunId: doc.payrollRunId, profileId: doc.profileId }), apply, {
      read: sourcePayrolls.length, skippedRows: reconciledPayrolls,
    });

    const skippedAnnouncements = [];
    const announcements = sourceAnnouncements.flatMap((announcement) => {
      const authorAccountId = accountIdBySourceId.get(String(announcement.authorId));
      if (!authorAccountId) {
        skippedAnnouncements.push({ sourceId: String(announcement._id), reasonCode: 'AUTHOR_ACCOUNT_NOT_MAPPED' });
        return [];
      }
      return [{
        _id: announcement._id, title: announcement.title || 'Announcement', content: announcement.content || '',
        category: announcement.category || 'NEWS', priority: announcement.priority || 'NORMAL',
        attachments: (announcement.attachments || []).map((mediaId) => ({ mediaId: String(mediaId), filename: null, mimeType: null })),
        authorAccountId, sendToAll: announcement.sendToAll !== false,
        targetDepartmentIds: (announcement.targetDepartments || []).filter((id) => departmentBySourceId.has(String(id))),
        targetProfileIds: (announcement.targetEmployees || []).map((id) => profileBySourceId.get(String(id))?._id).filter(Boolean),
        status: announcement.status || 'DRAFT', isPinned: Boolean(announcement.isPinned), scheduledAt: announcement.scheduledAt || null,
        publishedAt: announcement.publishedAt || null, publishedNotifiedAt: announcement.publishedAt || null,
        remindAt: announcement.remindAt || null, reminderSentAt: announcement.isReminderSent ? announcement.updatedAt || announcement.createdAt : null,
        eventDetails: announcement.eventDetails || null, isDeleted: Boolean(announcement.isDeleted), deletedAt: null,
        createdAt: announcement.createdAt, updatedAt: announcement.updatedAt,
      }];
    });
    const reconciledAnnouncements = reconcileRows(sourceAnnouncements, announcements, skippedAnnouncements, 'ANNOUNCEMENT_NOT_MAPPED');
    const announcementResult = await upsertMany(Announcement, announcements, (doc) => ({ _id: doc._id }), apply, {
      read: sourceAnnouncements.length, skippedRows: reconciledAnnouncements,
    });

    const skippedNotifications = [];
    const notifications = sourceNotifications.flatMap((notification) => {
      const recipientAccountId = accountIdBySourceId.get(String(notification.recipientId));
      if (!recipientAccountId) {
        skippedNotifications.push({ sourceId: String(notification._id), reasonCode: 'RECIPIENT_ACCOUNT_NOT_MAPPED' });
        return [];
      }
      return [{
        _id: notification._id, recipientAccountId, type: notification.type || 'LEGACY_NOTIFICATION',
        title: notification.title || 'Notification', message: notification.message || '',
        relatedResource: notification.relatedId ? { type: String(notification.relatedModel || 'legacy').toLowerCase(), id: String(notification.relatedId) } : null,
        deduplicationKey: `legacy:${notification._id}`, readAt: notification.isRead ? legacyFactDate(notification.updatedAt, notification.createdAt) : null,
        createdAt: notification.createdAt, updatedAt: notification.updatedAt,
      }];
    });
    const notificationWrite = await notificationPublic.migrateLegacyItems(notifications, { apply });
    const reconciledNotifications = reconcileRows(sourceNotifications, notifications, skippedNotifications, 'NOTIFICATION_NOT_MAPPED');
    const notificationResult = {
      read: sourceNotifications.length,
      mapped: notifications.length,
      skipped: reconciledNotifications.length,
      skippedRows: reconciledNotifications,
      ...notificationWrite,
    };

    const syncLog = sourceSyncLogs[0];
    const syncWatermark = syncLog ? [{
      key: 'default', status: syncLog.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED', lastSourceTimestamp: syncLog.finishedAt || null,
      lastSourceEventId: String(syncLog._id), lastSourceBatchId: `legacy:${syncLog._id}`,
      lastResult: { fetched: integer(syncLog.totalSqlEmployees), inserted: integer(syncLog.upserted), updated: integer(syncLog.modified), unchanged: 0, failed: syncLog.status === 'FAILED' ? 1 : 0 },
      errorMessage: syncLog.errorMessage || null, lastStartedAt: syncLog.startedAt || null, lastFinishedAt: syncLog.finishedAt || null,
    }] : [];
    const syncWrite = await integrationPublic.sqlAttendance.migrateLegacyState(syncWatermark[0], { apply });
    const syncResult = { read: sourceSyncLogs.length, mapped: syncWatermark.length, skipped: 0, skippedRows: [], ...syncWrite };

    return {
      mode: apply ? 'apply' : 'dry-run',
      sourceDb,
      targetDb,
      skippedProfiles,
      skippedOvertimes,
      results: {
        accounts: identityResult,
        departments: departmentResult,
        teams: teamResult,
        teamMemberships: membershipResult,
        workLocations: locationResult,
        shifts: shiftResult,
        employeeProfiles: profileResult,
        shiftAssignments: assignmentResult,
        leaveBalances: balanceResult,
        calendarOverrides: calendarResult,
        holidays: holidayResult,
        saturdayRotations: rotationResult,
        leaveRequests: leaveResult,
        overtimeRequests: overtimeResult,
        attendanceDaily: attendanceResult,
        payrollAdjustments: adjustmentResult,
        payrollRuns: payrollRunResult,
        payrollResults: payrollResult,
        announcements: announcementResult,
        notifications: notificationResult,
        sqlAttendanceSync: syncResult,
      },
    };
  } finally {
    await source.close();
    await disconnectDatabase();
  }
}

async function main() {
  const result = await migrateLngHrData(parseArgs());
  logger.info('lng_hr_migration_complete', result);
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('lng_hr_migration_failed', { error: error.message });
    process.exitCode = 1;
  });
}

module.exports = {
  assertIdentityApplyReady,
  attendanceSource,
  dateKey,
  buildAttendanceTimeBackfillOperations,
  backfillLngHrAttendanceTimes,
  legacyFactDate,
  legacyAttendanceAt,
  mapLegacyTeams,
  planLegacyIdentities,
  reconcileRows,
  migrateLngHrData,
  normalizeAttendanceStatus,
  normalizeEmployeeStatus,
  normalizeEmploymentType,
  normalizeLeaveType,
  normalizeRequestStatus,
  normalizeWorkMode,
  parseArgs,
  requestedUnits,
  summarizeBulkWrite,
  upsertMany,
};
