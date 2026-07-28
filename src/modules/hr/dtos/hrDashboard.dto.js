const ACTIVE_SCOPE = ['ACTIVE', 'PROBATION', 'ON_LEAVE'];

function toHrDashboardDto(readModel) {
  const employees = readModel.employeeStats || {};
  const attendance = readModel.attendanceStats || {};
  const approvals = readModel.approvalStats || {};
  const expectedEmployees = (employees.active || 0) + (employees.probation || 0) + (employees.onLeave || 0);
  const records = attendance.records || 0;
  const pendingLeaves = approvals.pendingLeaves || 0;
  const pendingOvertimes = approvals.pendingOvertimes || 0;
  return {
    date: readModel.dateKey,
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
      approvedOvertimesToday: approvals.approvedOvertimesToday || 0,
    },
  };
}

module.exports = { toHrDashboardDto };
