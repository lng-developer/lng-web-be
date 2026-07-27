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
      sourceRotations,
      sourcePayrollAdjustments,
      sourcePayrolls,
      sourceAnnouncements,
      sourceNotifications,
      sourceSyncLogs,
    ] = await Promise.all([
      src.collection('accounts').find({}).toArray(),
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

    const accountBySourceId = new Map(sourceAccounts.map((account) => [String(account._id), account]));
    const targetAccounts = await authPublic.listMigrationAccounts();
    const targetAccountByEmail = new Map(targetAccounts.flatMap((account) => [
      [String(account.email || '').toLowerCase(), account],
      [String(account.normalizedEmail || '').toLowerCase(), account],
    ]).filter(([email]) => email));
    const accountIdBySourceId = new Map(sourceAccounts.map((account) => {
      const target = targetAccountByEmail.get(String(account.email || account.username || '').toLowerCase());
      return [String(account._id), target?._id || null];
    }));

    const departments = sourceDepartments.map((department) => ({
      _id: department._id,
      name: department.name || department.deptCode || 'Department',
      code: String(department.deptCode || department.name || department._id).toUpperCase(),
      status: department.isActive === false ? 'INACTIVE' : 'ACTIVE',
      createdAt: department.createdAt,
      updatedAt: department.updatedAt,
    }));
    const departmentWrite = await organizationPublic.migrateLegacyDepartments(departments, { apply });
    const departmentResult = { read: sourceDepartments.length, mapped: departments.length, skipped: 0, skippedRows: [], ...departmentWrite };
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
    const teamWrite = await organizationPublic.migrateLegacyTeams(teams, { apply });
    const teamResult = { read: sourceTeams.length, mapped: teams.length, skipped: sourceTeams.length - teams.length, skippedRows: [], ...teamWrite };
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
        skippedProfiles.push({ sourceId: String(employee._id), reasonCode: 'TARGET_ACCOUNT_NOT_FOUND' });
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
      { read: sourceHolidays.length },
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
        appliedDepartmentIds: (holiday.appliedDepartments || []).filter((id) => departmentBySourceId.has(String(id))),
        appliedTeamIds: [],
        note: holiday.note || null,
        isActive: holiday.isActive !== false,
        createdAt: holiday.createdAt,
        updatedAt: holiday.updatedAt,
      }];
    });
    const holidayResult = await upsertMany(Holiday, holidays, (doc) => ({ dateKey: doc.dateKey }), apply, {
      read: sourceHolidays.length, skippedRows: skippedHolidays,
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
        teamId: rotation.teamId,
        workDateKey,
        month: Number(rotation.month),
        year: Number(rotation.year),
        employeeProfileIds,
        minPresent: Math.max(0, Number(rotation.minPresent || 0)),
        createdAt: rotation.createdAt,
        updatedAt: rotation.updatedAt,
      }];
    });
    const rotationResult = await upsertMany(SaturdayRotation, rotations, (doc) => ({ teamId: doc.teamId, workDateKey: doc.workDateKey }), apply, {
      read: sourceRotations.length, skippedRows: skippedRotations,
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
    const overtimeResult = await upsertMany(OvertimeRequest, overtimeRequests, (doc) => ({ _id: doc._id }), apply, {
      read: sourceOvertimes.length, skippedRows: skippedOvertimes,
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
    const adjustmentResult = await upsertMany(PayrollAdjustment, adjustments, (doc) => ({ _id: doc._id }), apply, {
      read: sourcePayrollAdjustments.length, skippedRows: skippedAdjustments,
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
    const payrollResult = await upsertMany(PayrollResult, payrollResults, (doc) => ({ payrollRunId: doc.payrollRunId, profileId: doc.profileId }), apply, {
      read: sourcePayrolls.length, skippedRows: skippedPayrolls,
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
    const announcementResult = await upsertMany(Announcement, announcements, (doc) => ({ _id: doc._id }), apply, {
      read: sourceAnnouncements.length, skippedRows: skippedAnnouncements,
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
    const notificationResult = {
      read: sourceNotifications.length,
      mapped: notifications.length,
      skipped: skippedNotifications.length,
      skippedRows: skippedNotifications,
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
        departments: departmentResult,
        teams: teamResult,
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
  attendanceSource,
  dateKey,
  legacyFactDate,
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
