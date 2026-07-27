const { normalizeRows } = require('../../../modules/integration/sqlAttendance/services/sqlAttendanceClient.service');

test('normalizes valid source rows and drops rows without a real employee or cursor', () => {
  expect(normalizeRows([
    { sourceId: 10, userId: 2501, occurredAt: '2026-07-18T01:00:00.000Z' },
    { sourceId: 11, occurredAt: '2026-07-18T01:01:00.000Z' },
    { userId: 2502, occurredAt: '2026-07-18T01:02:00.000Z' },
  ])).toEqual([{
    sourceId: '10',
    employeeCode: 'J2501',
    occurredAt: new Date('2026-07-18T01:00:00.000Z'),
  }]);
});
