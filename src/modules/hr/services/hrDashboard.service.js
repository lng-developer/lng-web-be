const attendanceRepository = require('../repositories/attendance.repository');
const employeeProfileRepository = require('../repositories/employeeProfile.repository');
const leaveRepository = require('../repositories/leave.repository');
const overtimeRepository = require('../repositories/overtime.repository');

const ACTIVE_SCOPE = ['ACTIVE', 'PROBATION', 'ON_LEAVE'];

async function getDashboard({ dateKey }) {
  const [employees = {}, attendance = {}, pendingLeaves, overtime = {}] = await Promise.all([
    employeeProfileRepository.aggregateDashboardStatuses(),
    attendanceRepository.aggregateDashboard(dateKey),
    leaveRepository.countPendingRequests(),
    overtimeRepository.aggregateDashboard(dateKey),
  ]);
  const expectedEmployees = (employees.active || 0) + (employees.probation || 0) + (employees.onLeave || 0);
  const records = attendance.records || 0;
  const pendingOvertimes = overtime.pending || 0;
  return {
    date: dateKey,
    employees: {
      total: employees.total || 0,
      active: employees.active || 0,
      probation: employees.probation || 0,
      onLeave: employees.onLeave || 0,
      activeScope: ACTIVE_SCOPE,
    },
    attendance: {
      expectedEmployees,
      records,
      present: attendance.present || 0,
      late: attendance.late || 0,
      absent: attendance.absent || 0,
      onLeave: attendance.onLeave || 0,
      missingCheckOuts: attendance.missingCheckOuts || 0,
      coverageRate: expectedEmployees ? Number(((records / expectedEmployees) * 100).toFixed(2)) : 0,
    },
    approvals: {
      pendingLeaves,
      pendingOvertimes,
      totalPending: pendingLeaves + pendingOvertimes,
      approvedOvertimesToday: overtime.approvedToday || 0,
    },
  };
}

module.exports = { getDashboard };
