const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Account = require('../../auth/models/account.model');
const Department = require('../../organization/models/department.model');
const Team = require('../../organization/models/team.model');
const EmployeeProfile = require('../models/employeeProfile.model');
const LeaveBalance = require('../models/leaveBalance.model');
const LeaveRequest = require('../models/leaveRequest.model');
const OvertimeRequest = require('../models/overtimeRequest.model');
const AttendanceDaily = require('../models/attendanceDaily.model');
const WorkLocation = require('../models/workLocation.model');
const Shift = require('../models/shift.model');
const ShiftAssignment = require('../models/shiftAssignment.model');
const CalendarOverride = require('../models/calendarOverride.model');
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

function parseArgs(argv = process.argv.slice(2)) {
  return {
    apply: argv.includes('--apply'),
    limit: Number(argv.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length) || 0),
  };
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
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

function toWriteResult(result = {}) {
  return Number(result.modifiedCount || 0) + Number(result.upsertedCount || 0);
}

async function upsertMany(Model, docs, buildFilter, apply) {
  if (!docs.length || !apply) return { scanned: docs.length, written: 0 };
  const result = await Model.bulkWrite(docs.map((doc) => ({
    updateOne: {
      filter: buildFilter(doc),
      update: {
        $set: Object.fromEntries(Object.entries(doc).filter(([key]) => key !== '_id')),
        ...(doc._id ? { $setOnInsert: { _id: doc._id } } : {}),
      },
      upsert: true,
    },
  })));
  return { scanned: docs.length, written: toWriteResult(result) };
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

async function migrateLngHrData(options = {}) {
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
      sourceDepartments,
      sourceTeams,
      sourceEmployees,
      sourceShifts,
      sourceHolidays,
    ] = await Promise.all([
      src.collection('accounts').find({}).toArray(),
      src.collection('departments').find({}).toArray(),
      src.collection('teams').find({}).toArray(),
      src.collection('employees').find({}, slice).toArray(),
      src.collection('shifts').find({}).toArray(),
      src.collection('holidays').find({}).toArray(),
    ]);

    const accountBySourceId = new Map(sourceAccounts.map((account) => [String(account._id), account]));
    const targetAccounts = await Account.find({}).select('_id email normalizedEmail').lean();
    const targetAccountByEmail = new Map(targetAccounts.flatMap((account) => [
      [String(account.email || '').toLowerCase(), account],
      [String(account.normalizedEmail || '').toLowerCase(), account],
    ]).filter(([email]) => email));

    const departments = sourceDepartments.map((department) => ({
      _id: department._id,
      name: department.name || department.deptCode || 'Department',
      code: String(department.deptCode || department.name || department._id).toUpperCase(),
      status: department.isActive === false ? 'INACTIVE' : 'ACTIVE',
      createdAt: department.createdAt,
      updatedAt: department.updatedAt,
    }));
    const departmentResult = await upsertMany(Department, departments, (doc) => ({ code: doc.code }), apply);
    const departmentBySourceId = new Map(departments.map((department) => [String(department._id), department]));

    const teams = sourceTeams
      .filter((team) => team.departmentId && departmentBySourceId.has(String(team.departmentId)))
      .map((team) => ({
        _id: team._id,
        name: team.name || team.teamCode || 'Team',
        code: String(team.teamCode || team.name || team._id).toUpperCase(),
        departmentId: team.departmentId,
        status: team.isActive === false ? 'INACTIVE' : 'ACTIVE',
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      }));
    const teamResult = await upsertMany(Team, teams, (doc) => ({ code: doc.code }), apply);
    const teamBySourceId = new Map(teams.map((team) => [String(team._id), team]));

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
      workdays: [1, 2, 3, 4, 5],
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
        workdays: [1, 2, 3, 4, 5],
        status: hrEmployeeStatuses.ACTIVE,
      });
    }
    const shiftResult = await upsertMany(Shift, shifts, (doc) => ({ code: doc.code }), apply);
    const fallbackShift = shifts[0];
    const shiftBySourceId = new Map(shifts.map((shift) => [String(shift._id), shift]));

    const skippedProfiles = [];
    const profiles = sourceEmployees.flatMap((employee) => {
      const sourceAccount = accountBySourceId.get(String(employee.accountId));
      const email = String(employee.workEmail || employee.personalEmail || sourceAccount?.username || '').toLowerCase();
      const targetAccount = targetAccountByEmail.get(email);
      if (!targetAccount) {
        skippedProfiles.push({ employeeId: String(employee._id), employeeCode: employee.employeeCode, reason: 'target_account_not_found' });
        return [];
      }
      return [{
        _id: employee._id,
        accountId: targetAccount._id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        gender: employee.gender || null,
        birthDate: employee.birthDate || null,
        phoneNumber: employee.phoneNumber || null,
        address: employee.address || null,
        avatarUrl: employee.avatar || null,
        personalEmail: employee.personalEmail || null,
        workEmail: employee.workEmail || email,
        emergencyContact: employee.emergencyContact || {},
        departmentId: departmentBySourceId.has(String(employee.departmentId)) ? employee.departmentId : null,
        teamId: teamBySourceId.has(String(employee.teamId)) ? employee.teamId : null,
        jobTitle: null,
        jobLevel: null,
        employmentType: normalizeEmploymentType(employee.employmentType),
        workMode: normalizeWorkMode(employee.workMode),
        startDate: employee.startDate || employee.createdAt || new Date(),
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
    const profileResult = await upsertMany(EmployeeProfile, profiles, (doc) => ({ _id: doc._id }), apply);
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
    const balanceResult = await upsertMany(
      LeaveBalance,
      leaveBalances,
      (doc) => ({ profileId: doc.profileId, year: doc.year, leaveType: doc.leaveType }),
      apply,
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
    const calendarResult = await upsertMany(
      CalendarOverride,
      calendarOverrides,
      (doc) => ({ dateKey: doc.dateKey, scopeType: doc.scopeType, scopeId: doc.scopeId }),
      apply,
    );

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
    const leaveResult = await upsertMany(LeaveRequest, leaveRequests, (doc) => ({ _id: doc._id }), apply);

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
        skippedOvertimes.push({
          overtimeId: String(overtime._id),
          employeeCode: profile.employeeCode,
          reason: 'duplicate_active_conflict_minute',
        });
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
    const overtimeResult = await upsertMany(OvertimeRequest, overtimeRequests, (doc) => ({ _id: doc._id }), apply);

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
        checkInAt: null,
        checkOutAt: null,
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
    const attendanceResult = await upsertMany(AttendanceDaily, attendances, (doc) => ({
      profileId: doc.profileId,
      workDateKey: doc.workDateKey,
    }), apply);

    return {
      mode: apply ? 'apply' : 'dry-run',
      sourceDb,
      targetDb,
      skippedProfiles,
      skippedOvertimes,
      results: {
        departments: departmentResult,
        teams: teamResult,
        workLocations: locationResult,
        shifts: shiftResult,
        employeeProfiles: profileResult,
        shiftAssignments: assignmentResult,
        leaveBalances: balanceResult,
        calendarOverrides: calendarResult,
        leaveRequests: leaveResult,
        overtimeRequests: overtimeResult,
        attendanceDaily: attendanceResult,
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
  attendanceSource,
  dateKey,
  migrateLngHrData,
  normalizeAttendanceStatus,
  normalizeEmployeeStatus,
  normalizeEmploymentType,
  normalizeLeaveType,
  normalizeRequestStatus,
  normalizeWorkMode,
  parseArgs,
  requestedUnits,
};
