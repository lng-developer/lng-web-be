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
      fullTime: employees.fullTime || 0,
      partTime: employees.partTime || 0,
      contractor: employees.contractor || 0,
      newThisMonth: employees.newThisMonth || 0,
      endingSoon: employees.endingSoon || 0,
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
    operations: {
      attendanceExceptions: readModel.operations?.attendanceExceptions || 0,
      pendingActions: readModel.operations?.pendingActions || pendingLeaves + pendingOvertimes,
    },
    payroll: readModel.payroll ? {
      id: readModel.payroll.id,
      month: readModel.payroll.month,
      year: readModel.payroll.year,
      status: readModel.payroll.status,
      resultCount: readModel.payroll.resultCount || 0,
      finalizedAt: readModel.payroll.finalizedAt || null,
      paidAt: readModel.payroll.paidAt || null,
      pendingAdjustments: readModel.payroll.pendingAdjustments || 0,
      summary: {
        total: readModel.payroll.summary?.total || 0,
        statusCounts: {
          DRAFT: readModel.payroll.summary?.statusCounts?.DRAFT || 0,
          FINALIZED: readModel.payroll.summary?.statusCounts?.FINALIZED || 0,
          PAID: readModel.payroll.summary?.statusCounts?.PAID || 0,
        },
        amounts: {
          grossIncome: readModel.payroll.summary?.amounts?.grossIncome || 0,
          netIncome: readModel.payroll.summary?.amounts?.netIncome || 0,
        },
      },
    } : null,
    announcements: {
      published: readModel.announcements?.published || 0,
      scheduled: readModel.announcements?.scheduled || 0,
      pinned: readModel.announcements?.pinned || 0,
      urgent: readModel.announcements?.urgent || 0,
      dueReminders: readModel.announcements?.dueReminders || 0,
    },
    ...(readModel.attendanceTrend ? {
      rangeDays: readModel.rangeDays,
      attendanceTrend: readModel.attendanceTrend.map((item) => ({
        date: item.dateKey,
        records: item.records || 0,
        present: item.present || 0,
        late: item.late || 0,
        absent: item.absent || 0,
        onLeave: item.onLeave || 0,
        missingCheckOuts: item.missingCheckOuts || 0,
        coverageRate: expectedEmployees
          ? Number((((item.records || 0) / expectedEmployees) * 100).toFixed(2))
          : 0,
      })),
    } : {}),
  };
}

module.exports = { toHrDashboardDto };
