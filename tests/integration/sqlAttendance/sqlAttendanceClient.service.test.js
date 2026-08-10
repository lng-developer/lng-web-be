jest.mock('mssql', () => ({}), { virtual: true });

const { normalizeRows } = require('../../../src/modules/integration/sqlAttendance/services/sqlAttendanceClient.service');

test('normalizes valid source rows and drops rows without a real employee or cursor', () => {
  expect(normalizeRows([
    { sourceEventId: 10, userId: 2501, occurredAt: '2026-07-18T01:00:00.000Z' },
    { sourceEventId: 11, occurredAt: '2026-07-18T01:01:00.000Z' },
    { userId: 2502, occurredAt: '2026-07-18T01:02:00.000Z' },
  ])).toEqual([{
    sourceEventId: '10',
    employeeCode: 'J2501',
    occurredAt: new Date('2026-07-18T01:00:00.000Z'),
  }]);
});

test('fails closed when the stable SQL event id column is not configured', async () => {
  const previous = process.env.DB_ATTENDANCE_EVENT_ID_COLUMN;
  delete process.env.DB_ATTENDANCE_EVENT_ID_COLUMN;
  jest.resetModules();
  const client = require('../../../src/modules/integration/sqlAttendance/services/sqlAttendanceClient.service');

  await expect(client.fetchPage({ limit: 1 })).rejects.toMatchObject({
    code: 'SQL_ATTENDANCE_EVENT_ID_REQUIRED',
  });

  if (previous === undefined) delete process.env.DB_ATTENDANCE_EVENT_ID_COLUMN;
  else process.env.DB_ATTENDANCE_EVENT_ID_COLUMN = previous;
});
