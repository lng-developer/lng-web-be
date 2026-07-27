const attendanceRepository = require('../repositories/attendance.repository');
const employeeProfileRepository = require('../repositories/employeeProfile.repository');
const leaveRepository = require('../repositories/leave.repository');
const overtimeRepository = require('../repositories/overtime.repository');

async function getDashboard({ dateKey }) {
  const [employees = {}, attendance = {}, pendingLeaves, overtime = {}] = await Promise.all([
    employeeProfileRepository.aggregateDashboardStatuses(),
    attendanceRepository.aggregateDashboard(dateKey),
    leaveRepository.countPendingRequests(),
    overtimeRepository.aggregateDashboard(dateKey),
  ]);
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
  };
}

module.exports = { getDashboard };
