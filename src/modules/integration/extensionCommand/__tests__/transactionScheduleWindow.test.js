const { transactionWindow } = require('../services/transactionScheduleWindow');

test('backfills all thirty days in consecutive chunks and then rescans three days', () => {
  const now = new Date('2026-09-17T10:00:00Z');
  const schedule = {};
  for (const [dateFrom, dateTo] of [
    ['2026-08-18', '2026-08-24'], ['2026-08-25', '2026-08-31'],
    ['2026-09-01', '2026-09-07'], ['2026-09-08', '2026-09-14'],
    ['2026-09-14', '2026-09-16'], ['2026-09-14', '2026-09-16'],
  ]) {
    expect(transactionWindow(schedule, now)).toEqual({ dateFrom, dateTo });
    schedule.lastSuccessfulDate = dateTo;
  }
});

test('uses UTC+7 yesterday even before UTC midnight', () => {
  expect(transactionWindow({ lastSuccessfulDate: '2026-09-15' }, new Date('2026-09-16T18:00:00Z')))
    .toEqual({ dateFrom: '2026-09-14', dateTo: '2026-09-16' });
});

test('retries the same initial chunk after a failure across midnight', () => {
  expect(transactionWindow({ backfillStartDate: '2026-08-18' }, new Date('2026-09-18T10:00:00Z')))
    .toEqual({ dateFrom: '2026-08-18', dateTo: '2026-08-24' });
});
