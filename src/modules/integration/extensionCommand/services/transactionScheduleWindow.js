const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function yesterday(now) {
  return addDays(new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10), -1);
}

function dateInTimezone(now, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function adsWindow(schedule, now) {
  const timezone = schedule.timezone || 'Asia/Ho_Chi_Minh';
  const end = addDays(dateInTimezone(now, timezone), -1);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const fixedTimes = Array.isArray(schedule.fixedTimes)
    ? schedule.fixedTimes.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))).sort()
    : [];
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekly = schedule.scheduleType === 'FIXED_TIMES'
    && parts.weekday === 'Sun'
    && fixedTimes.length > 0
    && currentMinutes >= minutes(fixedTimes[0])
    && (!fixedTimes[1] || currentMinutes < minutes(fixedTimes[1]));
  return { dateFrom: weekly ? addDays(end, -6) : end, dateTo: end };
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

module.exports = { transactionWindow, yesterday, adsWindow };
