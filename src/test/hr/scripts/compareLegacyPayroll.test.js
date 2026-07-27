const { comparePayrollRows } = require('../../../modules/hr/scripts/compareLegacyPayroll');

describe('compareLegacyPayroll', () => {
  test('reports the exact employee and field mismatch', () => {
    expect(comparePayrollRows(
      [{ employeeCode: 'E1', net: 1000 }],
      [{ employeeCode: 'E1', net: 900 }],
    )).toEqual([{ employeeCode: 'E1', field: 'net', legacy: 1000, pod: 900, delta: -100 }]);
  });

  test('recognizes the payroll snapshots used by both systems', () => {
    expect(comparePayrollRows(
      [{ employeeCodeSnapshot: 'E1', netIncome: 1000 }],
      [{ employeeSnapshot: { employeeCode: 'E1' }, netIncome: 1000 }],
    )).toEqual([]);
  });
});
