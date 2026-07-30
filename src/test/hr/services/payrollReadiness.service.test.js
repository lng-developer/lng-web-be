jest.mock('../../../modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../../modules/notification/public', () => ({}));
jest.mock('../../../modules/organization/public', () => ({ listTeamsByIds: jest.fn() }));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({}));
jest.mock('../../../modules/hr/repositories/payroll.repository', () => ({}));

const { payrollReadinessIssues } = require('../../../modules/hr/services/payroll.service');

describe('payrollReadinessIssues', () => {
  test('identifies active staff without a team or positive contracted salary', () => {
    expect(payrollReadinessIssues([
      { employeeCode: 'J2501', fullName: 'Hoang', teamId: null, baseSalary: 15000000 },
      { employeeCode: 'J2502', fullName: 'Trung', teamId: 'team-1', baseSalary: 0 },
      { employeeCode: 'J2503', fullName: 'Long', teamId: 'team-1', baseSalary: 12000000 },
    ])).toEqual([
      'J2501: missing team',
      'J2502: missing positive base salary',
    ]);
  });
});
