const { toPayrollResultDto } = require('../../../src/modules/hr/dtos/payroll.dto');

describe('toPayrollResultDto', () => {
  test('exposes the payroll-period employee, company, and compensation snapshot', () => {
    const result = toPayrollResultDto({
      _id: 'payroll-result-1',
      employeeSnapshot: {
        employeeCode: 'J2501', fullName: 'Nguyen Huy Hoang', teamId: 'team-1', departmentId: 'department-1',
        jobTitle: 'Designer', employmentType: 'FULL_TIME', startDate: '2025-01-02', avatarUrl: '/avatar',
      },
      inputSnapshot: {
        compensation: { baseSalary: 15000000 },
        payrollSettings: { workUnitScale: 1000, company: { name: 'LNG Group', currency: 'VND' } },
      },
      workUnits: 22000,
      salaryFromWork: 0,
    }, { markPaid: false }, { teamName: 'Fulfillment', departmentName: 'Design' });

    expect(result.employee.teamName).toBe('Fulfillment');
    expect(result.employee.departmentName).toBe('Design');
    expect(result.employee.jobTitle).toBe('Designer');
    expect(result.company).toEqual({ name: 'LNG Group', currency: 'VND' });
    expect(result.baseSalary).toBe(15000000);
    expect(result.workDays).toBe(22);
    expect(result.salaryFromWork).toBe(0);
  });
});
