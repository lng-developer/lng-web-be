const { hrAttendanceStatuses, hrRequestStatuses } = require('./constants/hr.constants');
const attendanceRepository = require('./repositories/attendance.repository');
const employeeProfileRepository = require('./repositories/employeeProfile.repository');
const leaveRepository = require('./repositories/leave.repository');
const overtimeRepository = require('./repositories/overtime.repository');
const authPublic = require('../auth/public');
const attendanceService = require('./services/attendance.service');
const payrollService = require('./services/payroll.service');

function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toPublicProfileDto(profile) {
  if (!profile) return null;
  return {
    id: toId(profile),
    accountId: toId(profile.accountId),
    employeeCode: profile.employeeCode || null,
    fullName: profile.fullName || null,
    displayName: profile.fullName || null,
    departmentId: toId(profile.departmentId),
    teamId: toId(profile.teamId),
    status: profile.status || null,
  };
}

async function getEmployeeProfileByAccountId(accountId, options = {}) {
  const profile = await employeeProfileRepository.findPublicByAccountId(accountId, options);
  return toPublicProfileDto(profile);
}

async function getEmployeeProfileByEmployeeCode(employeeCode, options = {}) {
  const profile = await employeeProfileRepository.findPublicByEmployeeCode(employeeCode, options);
  return toPublicProfileDto(profile);
}

async function listEmployeeProfilesByAccountIds(accountIds = [], options = {}) {
  const profiles = await employeeProfileRepository.listPublicByAccountIds(accountIds, options);
  return profiles.map(toPublicProfileDto);
}

async function listEmployeeProfilesByEmployeeCodes(employeeCodes = [], options = {}) {
  const profiles = await employeeProfileRepository.listPublicByEmployeeCodes(employeeCodes, options);
  return profiles.map(toPublicProfileDto);
}

async function listAssignableProfiles(query = {}) {
  const profiles = await employeeProfileRepository.listPublicProfiles(query);
  const allowedIds = new Set(await authPublic.filterAssignableAccountIds(
    profiles.map((profile) => String(profile.accountId)),
    query.requiredPermission,
  ));
  return profiles.filter((profile) => allowedIds.has(String(profile.accountId))).map(toPublicProfileDto);
}

function inDateRange(dateKey, { dateFrom, dateTo } = {}) {
  return (!dateFrom || dateKey >= dateFrom) && (!dateTo || dateKey <= dateTo);
}

async function listAll(listPage, query) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const result = await listPage({ ...query, page, limit: 100 });
    items.push(...(result.items || []));
    if (items.length >= (result.pagination?.total || 0) || !(result.items || []).length) break;
  }
  return items;
}

function addByDate(target, dateKey, value) {
  target.set(dateKey, (target.get(dateKey) || 0) + value);
}

async function getApprovedTimeRecords(profileId, dateRange = {}) {
  const safeProfileId = toId(profileId);
  if (!safeProfileId) return { profileId: null, leave: [], overtime: [] };
  const query = {
    profileId: safeProfileId,
    status: hrRequestStatuses.APPROVED,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
  };
  const [leaveRequests, overtimeRequests] = await Promise.all([
    listAll((pageQuery) => leaveRepository.listRequests(pageQuery), query),
    listAll((pageQuery) => overtimeRepository.listRequests(pageQuery), query),
  ]);
  const leaveByDate = new Map();
  const leaveStatesByDate = new Map();
  for (const request of leaveRequests) {
    for (const snapshot of request.workingDateSnapshots || []) {
      if (!inDateRange(snapshot.dateKey, dateRange)) continue;
      addByDate(leaveByDate, snapshot.dateKey, snapshot.units || 0);
      if (!leaveStatesByDate.has(snapshot.dateKey)) leaveStatesByDate.set(snapshot.dateKey, new Set());
      if (request.attendanceStatus) leaveStatesByDate.get(snapshot.dateKey).add(request.attendanceStatus);
    }
  }
  const overtimeByDate = new Map();
  for (const request of overtimeRequests) {
    if (!inDateRange(request.workDateKey, dateRange)) continue;
    addByDate(overtimeByDate, request.workDateKey, request.approvedMinutes || 0);
  }
  return {
    profileId: safeProfileId,
    leave: [...leaveByDate].sort(([left], [right]) => left.localeCompare(right)).map(
      ([workDateKey, approvedLeaveUnits]) => {
        const states = [...(leaveStatesByDate.get(workDateKey) || [])].sort();
        return {
        profileId: safeProfileId,
        workDateKey,
        attendanceState: states.length > 1 ? hrAttendanceStatuses.MIXED_LEAVE : (states[0] || null),
        approvedLeaveUnits,
        };
      },
    ),
    overtime: [...overtimeByDate].sort(([left], [right]) => left.localeCompare(right)).map(
      ([workDateKey, approvedOvertimeMinutes]) => ({
        profileId: safeProfileId,
        workDateKey,
        approvedOvertimeMinutes,
      }),
    ),
  };
}

async function getAttendanceSummaryByProfileIds(profileIds = [], dateRange = {}) {
  const uniqueProfileIds = [...new Set(profileIds.map(toId).filter(Boolean))];
  const summaries = await Promise.all(uniqueProfileIds.map(async (profileId) => {
    const [attendance, approved] = await Promise.all([
      listAll((query) => attendanceRepository.list(query), {
        profileId,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      }),
      getApprovedTimeRecords(profileId, dateRange),
    ]);
    const byDate = new Map();
    for (const record of attendance) {
      byDate.set(record.workDateKey, {
        profileId,
        workDateKey: record.workDateKey,
        attendanceState: record.status || null,
        approvedLeaveUnits: 0,
        approvedOvertimeMinutes: 0,
      });
    }
    for (const record of approved.leave) {
      const summary = byDate.get(record.workDateKey) || {
        profileId,
        workDateKey: record.workDateKey,
        attendanceState: null,
        approvedLeaveUnits: 0,
        approvedOvertimeMinutes: 0,
      };
      summary.approvedLeaveUnits = record.approvedLeaveUnits;
      byDate.set(record.workDateKey, summary);
    }
    for (const record of approved.overtime) {
      const summary = byDate.get(record.workDateKey) || {
        profileId,
        workDateKey: record.workDateKey,
        attendanceState: null,
        approvedLeaveUnits: 0,
        approvedOvertimeMinutes: 0,
      };
      summary.approvedOvertimeMinutes = record.approvedOvertimeMinutes;
      byDate.set(record.workDateKey, summary);
    }
    return [...byDate.values()].sort((left, right) => left.workDateKey.localeCompare(right.workDateKey));
  }));
  return summaries.flat();
}

module.exports = {
  calculatePayroll: payrollService.calculatePayroll,
  finalizePayroll: payrollService.finalizePayroll,
  getEmployeeProfileByAccountId,
  getEmployeeProfileByEmployeeCode,
  getApprovedTimeRecords,
  getAttendanceSummaryByProfileIds,
  importAttendancePunches: attendanceService.importAttendancePunches,
  markPayrollPaid: payrollService.markPayrollPaid,
  listEmployeeProfilesByAccountIds,
  listEmployeeProfilesByEmployeeCodes,
  listAssignableProfiles,
};
