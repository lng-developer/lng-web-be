const RATE_MINUTE_KEYS = Object.freeze([
  'weekday', 'weekend', 'holiday', 'weekday_night', 'weekend_night', 'holiday_night',
]);

function emptyAllocation() {
  return Object.fromEntries(RATE_MINUTE_KEYS.map((key) => [key, 0]));
}

function baseRateClass(calendarClass) {
  if (calendarClass === 'REST_DAY') return 'weekend';
  if (calendarClass === 'HOLIDAY') return 'holiday';
  return 'weekday';
}

function validStoredAllocation(allocation, approvedMinutes) {
  return allocation
    && RATE_MINUTE_KEYS.every((key) => Number.isInteger(allocation[key]) && allocation[key] >= 0)
    && RATE_MINUTE_KEYS.reduce((sum, key) => sum + allocation[key], 0) === approvedMinutes;
}

function deriveApprovedRateMinutes({
  approvedMinutes, calendarClass, plannedStartAt, plannedEndAt, timezone = 'Asia/Ho_Chi_Minh',
}) {
  const start = new Date(plannedStartAt);
  const end = new Date(plannedEndAt);
  if (!Number.isInteger(approvedMinutes) || approvedMinutes <= 0) {
    throw new TypeError('approvedMinutes must be a positive integer');
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new TypeError('Approved overtime requires valid planned timestamps');
  }
  const approvedStart = new Date(end.getTime() - (approvedMinutes * 60000));
  if (approvedStart < start) throw new TypeError('approvedMinutes exceed the planned overtime interval');

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', hourCycle: 'h23', minute: '2-digit',
  });
  const allocation = emptyAllocation();
  const dayClass = baseRateClass(calendarClass);
  for (let cursor = approvedStart.getTime(); cursor < end.getTime(); cursor += 60000) {
    const hour = Number(formatter.formatToParts(new Date(cursor)).find((part) => part.type === 'hour')?.value);
    allocation[hour >= 22 || hour < 6 ? `${dayClass}_night` : dayClass] += 1;
  }
  return allocation;
}

function resolveApprovedRateMinutes(request) {
  if (validStoredAllocation(request.approvedRateMinutes, request.approvedMinutes)) {
    return { approvedRateMinutes: { ...request.approvedRateMinutes }, allocationSource: 'STORED' };
  }
  return {
    approvedRateMinutes: deriveApprovedRateMinutes({
      approvedMinutes: request.approvedMinutes,
      calendarClass: request.calendarClass,
      plannedStartAt: request.plannedStartAt,
      plannedEndAt: request.plannedEndAt,
      timezone: request.scheduleSnapshot?.timezone || 'Asia/Ho_Chi_Minh',
    }),
    allocationSource: 'COMPATIBILITY_DERIVED',
  };
}

module.exports = { RATE_MINUTE_KEYS, deriveApprovedRateMinutes, resolveApprovedRateMinutes };
