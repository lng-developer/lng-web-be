const { vietnamDate } = require('../../tools/scripts/maintenance/reconcileFinanceLedgerRows');

describe('reconcileFinanceLedgerRows date validation', () => {
  test('rejects impossible calendar dates before connecting to the database', () => {
    expect(() => vietnamDate('2026-02-31')).toThrow('Dates must be valid calendar days');
  });
});
