const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

function getTimezoneOffsetMs(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(date);
    const partMap = {};
    for (const p of parts) partMap[p.type] = p.value;
    const asUtc = Date.UTC(
      Number(partMap.year),
      Number(partMap.month) - 1,
      Number(partMap.day),
      Number(partMap.hour),
      Number(partMap.minute),
      Number(partMap.second),
    );
    return asUtc - date.getTime();
  } catch {
    // Fallback if timezone string is invalid
    return 7 * 60 * 60 * 1000; // default UTC+7
  }
}

function parseTimeInTimezone(ymd, time, timeZone) {
  const [year, month, day] = ymd.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const date = new Date(asUtc);
  const offset = getTimezoneOffsetMs(date, timeZone);
  return new Date(asUtc - offset);
}

function normalizeTimezone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return 'Asia/Ho_Chi_Minh';
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return 'Asia/Ho_Chi_Minh';
  }
}

function calculateNextRunAt({
  scheduleType = 'INTERVAL',
  intervalMinutes = 120,
  fixedTimes = [],
  timezone = 'Asia/Ho_Chi_Minh',
  now = new Date(),
  bufferSeconds = 30,
} = {}) {
  const tz = normalizeTimezone(timezone);

  if (scheduleType === 'FIXED_TIMES' && Array.isArray(fixedTimes) && fixedTimes.length > 0) {
    const validTimes = [...new Set(fixedTimes)]
      .filter((t) => timeRegex.test(String(t || '').trim()))
      .map((t) => String(t).trim())
      .sort();

    if (validTimes.length > 0) {
      const todayYmd = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);

      const thresholdTime = now.getTime() + bufferSeconds * 1000;

      for (const timeStr of validTimes) {
        const candidate = parseTimeInTimezone(todayYmd, timeStr, tz);
        if (candidate.getTime() > thresholdTime) {
          return candidate;
        }
      }

      // If no candidate today is in future, pick first time of tomorrow
      const tomorrowDate = new Date(now.getTime() + 24 * 3600 * 1000);
      const tomorrowYmd = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(tomorrowDate);

      return parseTimeInTimezone(tomorrowYmd, validTimes[0], tz);
    }
  }

  const interval = Math.max(1, Number(intervalMinutes) || 120);
  return new Date(now.getTime() + interval * 60 * 1000);
}

module.exports = {
  timeRegex,
  normalizeTimezone,
  parseTimeInTimezone,
  calculateNextRunAt,
};
