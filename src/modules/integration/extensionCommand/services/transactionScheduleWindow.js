const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function yesterday(now) {
  return addDays(new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10), -1);
}

function transactionWindow(schedule, now) {
  const end = yesterday(now);
  const overlapStart = addDays(end, -2);
  const next = schedule.lastSuccessfulDate && addDays(schedule.lastSuccessfulDate, 1);
  const dateFrom = next ? (next < overlapStart ? next : overlapStart)
    : (schedule.backfillStartDate || addDays(end, -29));
  const chunkEnd = addDays(dateFrom, 6);
  return { dateFrom, dateTo: chunkEnd < end ? chunkEnd : end };
}

module.exports = { transactionWindow, yesterday };
