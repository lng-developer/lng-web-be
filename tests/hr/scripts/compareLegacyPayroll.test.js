const { comparePayrollRows, toSafeComparisonReport, writeSafeComparisonReport } = require('../../../src/modules/hr/scripts/compareLegacyPayroll');

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

  test('rounds legacy money exactly like persisted integer payroll data and keeps null or invalid distinct from zero', () => {
    expect(comparePayrollRows(
      [{ employeeCode: 'E1', net: 1000.4 }, { employeeCode: 'E2', net: null }, { employeeCode: 'E3', net: 'not-money' }],
      [{ employeeCode: 'E1', net: 1000 }, { employeeCode: 'E2', net: 0 }, { employeeCode: 'E3', net: 0 }],
    )).toEqual([
      { employeeCode: 'E2', field: 'net', legacy: null, pod: 0, delta: null },
      { employeeCode: 'E3', field: 'net', legacy: 'INVALID', pod: 0, delta: null },
    ]);
  });

  test('builds a machine-readable cutover report without payroll values', () => {
    expect(toSafeComparisonReport({ month: 7, year: 2026, legacyCount: 1, podCount: 1, differences: [{ employeeCode: 'E1', field: 'net', legacy: 1000, pod: 900 }] }))
      .toEqual({ month: 7, year: 2026, legacyCount: 1, podCount: 1, differenceCount: 1, gateCodes: ['PAYROLL_DIFFERENCES_PRESENT'] });
  });

  test('writes only the safe comparison contract for readiness', () => {
    const filePath = require('path').join(require('os').tmpdir(), `hr-comparison-${process.pid}.json`);
    writeSafeComparisonReport({ month: 7, year: 2026, legacyCount: 1, podCount: 1, differences: [{ legacy: 1000, pod: 900 }] }, filePath);
    expect(JSON.parse(require('fs').readFileSync(filePath, 'utf8'))).toEqual({
      month: 7, year: 2026, legacyCount: 1, podCount: 1, differenceCount: 1, gateCodes: ['PAYROLL_DIFFERENCES_PRESENT'],
    });
    require('fs').unlinkSync(filePath);
  });
});
