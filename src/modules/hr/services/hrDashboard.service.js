const attendanceRepository = require('../repositories/attendance.repository');
const employeeProfileRepository = require('../repositories/employeeProfile.repository');
const leaveRepository = require('../repositories/leave.repository');
const overtimeRepository = require('../repositories/overtime.repository');

function rangeDateKeys(dateKey, days) {
  const end = new Date(`${dateKey}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (days - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

async function getDashboard({ dateKey, days }) {
  const [employees = {}, attendance = {}, pendingLeaves, overtime = {}] = await Promise.all([
    employeeProfileRepository.aggregateDashboardStatuses(),
    attendanceRepository.aggregateDashboard(dateKey),
    leaveRepository.countPendingRequests(),
    overtimeRepository.aggregateDashboard(dateKey),
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
    ...(trend ? { rangeDays: days, attendanceTrend: trend } : {}),
  };
}

module.exports = { getDashboard };
