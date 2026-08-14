const attendanceRepository = require('../repositories/attendance.repository');
const announcementRepository = require('../repositories/announcement.repository');
const employeeProfileRepository = require('../repositories/employeeProfile.repository');
const leaveRepository = require('../repositories/leave.repository');
const overtimeRepository = require('../repositories/overtime.repository');
const payrollRepository = require('../repositories/payroll.repository');

function rangeDateKeys(dateKey, days) {
  const end = new Date(`${dateKey}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (days - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

async function getDashboard({ dateKey, days }) {
  const [
    employees = {},
    attendance = {},
    pendingLeaves,
    overtime = {},
    latestPayroll,
    announcements = {},
  ] = await Promise.all([
    employeeProfileRepository.aggregateDashboardStatuses(dateKey),
    attendanceRepository.aggregateDashboard(dateKey),
    leaveRepository.countPendingRequests(),
    overtimeRepository.aggregateDashboard(dateKey),
    payrollRepository.getLatestRunSummary(),
    announcementRepository.aggregateDashboardCounts(),
  ]);
  const trend = days
    ? await Promise.all(rangeDateKeys(dateKey, days).map(async (trendDateKey) => ({
      dateKey: trendDateKey,
      ...await attendanceRepository.aggregateDashboard(trendDateKey),
    })))
    : null;
  return {
    dateKey,
    employeeStats: {
      total: employees.total || 0,
      active: employees.active || 0,
      probation: employees.probation || 0,
      onLeave: employees.onLeave || 0,
      fullTime: employees.fullTime || 0,
      partTime: employees.partTime || 0,
      contractor: employees.contractor || 0,
      newThisMonth: employees.newThisMonth || 0,
      endingSoon: employees.endingSoon || 0,
    },
    attendanceStats: {
      records: attendance.records || 0,
      present: attendance.present || 0,
      late: attendance.late || 0,
      absent: attendance.absent || 0,
      onLeave: attendance.onLeave || 0,
      missingCheckOuts: attendance.missingCheckOuts || 0,
    },
    approvalStats: {
      pendingLeaves,
      pendingOvertimes: overtime.pending || 0,
      approvedOvertimesToday: overtime.approvedToday || 0,
    },
    operations: {
      attendanceExceptions: (attendance.late || 0) + (attendance.absent || 0) + (attendance.missingCheckOuts || 0),
      pendingActions: (pendingLeaves || 0) + (overtime.pending || 0) + (latestPayroll?.pendingAdjustments || 0),
    },
    payroll: latestPayroll,
    announcements: {
      published: announcements.published || 0,
      scheduled: announcements.scheduled || 0,
      pinned: announcements.pinned || 0,
      urgent: announcements.urgent || 0,
      dueReminders: announcements.dueReminders || 0,
    },
    ...(trend ? { rangeDays: days, attendanceTrend: trend } : {}),
  };
}

module.exports = { getDashboard };
