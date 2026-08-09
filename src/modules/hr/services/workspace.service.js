const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { hrPermissions, hrTimePermissions } = require('../constants/hr.constants');
const announcementRepository = require('../repositories/announcement.repository');
const attendanceRepository = require('../repositories/attendance.repository');
const profileRepository = require('../repositories/employeeProfile.repository');
const leaveRepository = require('../repositories/leave.repository');
const overtimeRepository = require('../repositories/overtime.repository');
const payrollRepository = require('../repositories/payroll.repository');
const attendanceService = require('./attendance.service');
const profileService = require('./employeeProfile.service');
const leaveService = require('./leave.service');
const overtimeService = require('./overtime.service');
const scheduleService = require('./schedule.service');
const scheduleResolver = require('./scheduleResolver.service');

const toId = (value) => value ? String(value._id || value.id || value) : null;
const emptyPage = () => ({ items: [], pagination: { page: 1, limit: 100, total: 0 } });
const permissionSet = (auth = {}) => new Set([
  ...(auth.permissions || []),
  ...(auth.scopes || []).flatMap((scope) => scope.permissions || []),
]);
const hasAny = (auth, codes) => {
  const granted = permissionSet(auth);
  return codes.some((code) => granted.has(code));
};

function monthDateKeys(year, month) {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`);
}

async function getMyWorkspace({ dateKey, year, month }, authContext = {}) {
  const profile = await profileRepository.findByAccountId(authContext.accountId);
  if (!profile) throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  const profileId = toId(profile);
  const announcementFilter = {
    status: 'PUBLISHED',
    $or: [
      { sendToAll: true },
      { targetProfileIds: profile._id || profile.id },
      ...(profile.departmentId ? [{ targetDepartmentIds: profile.departmentId }] : []),
    ],
  };
  const dateKeys = monthDateKeys(year, month);
  const dateFrom = dateKeys[0];
  const dateTo = dateKeys.at(-1);
  const [schedule, attendance, monthlyAttendance, balances, leaveRequests, overtimeRequests, payroll, announcements] = await Promise.all([
    Promise.all(dateKeys.map((workDateKey) => scheduleResolver.resolveWorkContext({ profileId, workDateKey }))),
    attendanceRepository.findByProfileAndWorkDate(profileId, dateKey),
    attendanceRepository.list({ profileId, dateFrom, dateTo, limit: 100 }),
    leaveRepository.listBalances({ profileId, year }),
    leaveRepository.listRequests({ profileId, dateFrom, dateTo, limit: 100 }),
    overtimeRepository.listRequests({ profileId, dateFrom, dateTo, limit: 100 }),
    payrollRepository.listResultsForAccount(authContext.accountId, { limit: 1 }),
    announcementRepository.list({ filter: announcementFilter, limit: 5 }),
  ]);
  const attendanceByDate = new Map((monthlyAttendance.items || []).map((item) => [item.workDateKey, item]));
  const calendar = schedule.map((day) => ({
    ...day,
    attendance: attendanceByDate.get(day.workDateKey) || null,
    leave: (leaveRequests.items || []).filter((item) => item.startDateKey <= day.workDateKey && item.endDateKey >= day.workDateKey),
    overtime: (overtimeRequests.items || []).filter((item) => item.workDateKey === day.workDateKey),
  }));
  return {
    dateKey,
    profile: { id: profileId, employeeCode: profile.employeeCode, fullName: profile.fullName, departmentId: toId(profile.departmentId), teamId: toId(profile.teamId), jobTitle: profile.jobTitle || null, status: profile.status },
    today: { schedule: schedule.find((item) => item.workDateKey === dateKey) || null, attendance: attendance || null },
    schedule,
    calendar,
    leave: { balances, availableUnits: balances.reduce((sum, item) => sum + (item.availableUnits || 0), 0), requests: leaveRequests.items || [] },
    overtime: { requests: overtimeRequests.items || [] },
    latestPayroll: payroll.items?.[0] || null,
    announcements: announcements.items || [],
  };
}

async function getTeamWorkspace({ dateKey, teamId, days = 1 }, authContext = {}) {
  const attendanceAllowed = hasAny(authContext, [hrTimePermissions.ATTENDANCE_READ, hrTimePermissions.ATTENDANCE_MANAGE]);
  const leaveAllowed = hasAny(authContext, [hrTimePermissions.LEAVE_READ, hrTimePermissions.LEAVE_APPROVE]);
  const overtimeAllowed = hasAny(authContext, [hrTimePermissions.OVERTIME_READ, hrTimePermissions.OVERTIME_APPROVE]);
  const scheduleAllowed = hasAny(authContext, [hrTimePermissions.SCHEDULE_READ, hrTimePermissions.SCHEDULE_WRITE]);
  const profilesAllowed = hasAny(authContext, [hrPermissions.EMPLOYEE_READ, hrPermissions.EMPLOYEE_WRITE, hrTimePermissions.SCHEDULE_READ, hrTimePermissions.SCHEDULE_WRITE, hrTimePermissions.ATTENDANCE_READ, hrTimePermissions.ATTENDANCE_MANAGE]);
  const query = { ...(teamId ? { teamId } : {}), limit: 100 };
  const rangeStart = new Date(`${dateKey}T00:00:00.000Z`);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - days + 1);
  const dateFrom = rangeStart.toISOString().slice(0, 10);
  const [profiles, attendance, leaves, overtime, assignments] = await Promise.all([
    profilesAllowed ? profileService.listProfiles(query, authContext) : emptyPage(),
    attendanceAllowed ? attendanceService.listAttendance({ ...query, dateFrom, dateTo: dateKey }, authContext) : emptyPage(),
    leaveAllowed ? leaveService.listRequests({ ...query, status: 'PENDING' }, authContext) : emptyPage(),
    overtimeAllowed ? overtimeService.listRequests({ ...query, status: 'PENDING' }, authContext) : emptyPage(),
    scheduleAllowed ? scheduleService.listAssignments(query, authContext) : emptyPage(),
  ]);
  return { dateKey, rangeDays: days, profiles, attendance, pendingLeaves: leaves, pendingOvertime: overtime, assignments };
}

module.exports = { getMyWorkspace, getTeamWorkspace };
