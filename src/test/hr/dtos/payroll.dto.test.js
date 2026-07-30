const { toPayrollResultDto } = require('../../../modules/hr/dtos/payroll.dto');

describe('toPayrollResultDto', () => {
  test('exposes the payroll-period team name and contracted base salary', () => {
    const result = toPayrollResultDto({
      _id: 'payroll-result-1',
      employeeSnapshot: { employeeCode: 'J2501', fullName: 'Nguyen Huy Hoang', teamId: 'team-1' },
      inputSnapshot: { compensation: { baseSalary: 15000000 } },
      salaryFromWork: 0,
    }, { markPaid: false }, { teamName: 'Fulfillment' });

    expect(result.employee.teamName).toBe('Fulfillment');
    expect(result.baseSalary).toBe(15000000);
    expect(result.salaryFromWork).toBe(0);
  });
});
