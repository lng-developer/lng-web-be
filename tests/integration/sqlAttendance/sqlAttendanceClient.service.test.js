jest.mock('mssql', () => ({}), { virtual: true });

const {
  normalizeRows,
  resolveEventIdExpression,
} = require('../../../src/modules/integration/sqlAttendance/services/sqlAttendanceClient.service');

test('normalizes valid source rows and drops rows without a real employee or cursor', () => {
  expect(normalizeRows([
    { sourceEventId: 10, userId: 2501, occurredAt: '2026-07-18T01:00:00.000Z' },
    { sourceEventId: 11, occurredAt: '2026-07-18T01:01:00.000Z' },
    { userId: 2502, occurredAt: '2026-07-18T01:02:00.000Z' },
    { sourceEventId: 12, userId: 'J3001', occurredAt: '2026-07-18T01:03:00.000Z' },
    { sourceEventId: 13, employeeCode: 'J4001', userId: '4001', occurredAt: '2026-07-18T01:04:00.000Z' },
  ])).toEqual([
    {
      sourceEventId: '10',
      employeeCode: 'J2501',
      occurredAt: new Date('2026-07-18T01:00:00.000Z'),
    },
    {
      sourceEventId: '12',
      employeeCode: 'J3001',
      occurredAt: new Date('2026-07-18T01:03:00.000Z'),
    },
    {
      sourceEventId: '13',
      employeeCode: 'J4001',
      occurredAt: new Date('2026-07-18T01:04:00.000Z'),
    },
  ]);
});

test('fails closed when the stable SQL event id column is not configured and composite mode is off', async () => {
  const previousColumn = process.env.DB_ATTENDANCE_EVENT_ID_COLUMN;
  const previousComposite = process.env.DB_ATTENDANCE_USE_COMPOSITE_ID;
  delete process.env.DB_ATTENDANCE_EVENT_ID_COLUMN;
  delete process.env.DB_ATTENDANCE_USE_COMPOSITE_ID;
  jest.resetModules();
  const client = require('../../../src/modules/integration/sqlAttendance/services/sqlAttendanceClient.service');

  await expect(client.fetchPage({ limit: 1 })).rejects.toMatchObject({
    code: 'SQL_ATTENDANCE_EVENT_ID_REQUIRED',
  });

  if (previousColumn === undefined) delete process.env.DB_ATTENDANCE_EVENT_ID_COLUMN;
  else process.env.DB_ATTENDANCE_EVENT_ID_COLUMN = previousColumn;
  if (previousComposite === undefined) delete process.env.DB_ATTENDANCE_USE_COMPOSITE_ID;
  else process.env.DB_ATTENDANCE_USE_COMPOSITE_ID = previousComposite;
});

test('resolves event id expression using column name or composite expression', () => {
  const prevCol = process.env.DB_ATTENDANCE_EVENT_ID_COLUMN;
  const prevComp = process.env.DB_ATTENDANCE_USE_COMPOSITE_ID;

  // Single column
  process.env.DB_ATTENDANCE_EVENT_ID_COLUMN = 'LogID';
  delete process.env.DB_ATTENDANCE_USE_COMPOSITE_ID;
  expect(resolveEventIdExpression('[USERID]', '[CHECKTIME]')).toBe('[LogID]');

  // Composite expression
  delete process.env.DB_ATTENDANCE_EVENT_ID_COLUMN;
  process.env.DB_ATTENDANCE_USE_COMPOSITE_ID = 'true';
  expect(resolveEventIdExpression('[USERID]', '[CHECKTIME]')).toBe(
    "CONCAT(CONVERT(nvarchar(100), [USERID]), N'_', CONVERT(nvarchar(30), [CHECKTIME], 120))",
  );

  if (prevCol === undefined) delete process.env.DB_ATTENDANCE_EVENT_ID_COLUMN;
  else process.env.DB_ATTENDANCE_EVENT_ID_COLUMN = prevCol;
  if (prevComp === undefined) delete process.env.DB_ATTENDANCE_USE_COMPOSITE_ID;
  else process.env.DB_ATTENDANCE_USE_COMPOSITE_ID = prevComp;
});
