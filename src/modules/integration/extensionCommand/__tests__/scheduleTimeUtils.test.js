const {
  timeRegex,
  parseTimeInTimezone,
  calculateNextRunAt,
} = require('../services/scheduleTimeUtils');

describe('scheduleTimeUtils', () => {
  describe('timeRegex', () => {
    test('validates 24-hour time strings', () => {
      expect(timeRegex.test('00:00')).toBe(true);
      expect(timeRegex.test('10:00')).toBe(true);
      expect(timeRegex.test('17:00')).toBe(true);
      expect(timeRegex.test('23:59')).toBe(true);

      expect(timeRegex.test('24:00')).toBe(false);
      expect(timeRegex.test('9:00')).toBe(false);
      expect(timeRegex.test('10:60')).toBe(false);
      expect(timeRegex.test('abc')).toBe(false);
    });
  });

  describe('parseTimeInTimezone', () => {
    test('accurately parses 10:00 VN time (UTC+7) to UTC date', () => {
      const parsed = parseTimeInTimezone('2026-11-04', '10:00', 'Asia/Ho_Chi_Minh');
      expect(parsed.toISOString()).toBe('2026-11-04T03:00:00.000Z');
    });

    test('accurately parses 17:00 VN time (UTC+7) to UTC date', () => {
      const parsed = parseTimeInTimezone('2026-11-04', '17:00', 'Asia/Ho_Chi_Minh');
      expect(parsed.toISOString()).toBe('2026-11-04T10:00:00.000Z');
    });
  });

  describe('calculateNextRunAt', () => {
    test('returns next fixed time on the same day when future time exists', () => {
      // 08:00 VN time (01:00 UTC)
      const now = new Date('2026-11-04T01:00:00.000Z');
      const next = calculateNextRunAt({
        scheduleType: 'FIXED_TIMES',
        fixedTimes: ['10:00', '17:00'],
        timezone: 'Asia/Ho_Chi_Minh',
        now,
      });
      // Should be 10:00 VN time (03:00 UTC)
      expect(next.toISOString()).toBe('2026-11-04T03:00:00.000Z');
    });

    test('returns second fixed time when first fixed time has passed', () => {
      // 10:01 VN time (03:01 UTC)
      const now = new Date('2026-11-04T03:01:00.000Z');
      const next = calculateNextRunAt({
        scheduleType: 'FIXED_TIMES',
        fixedTimes: ['10:00', '17:00'],
        timezone: 'Asia/Ho_Chi_Minh',
        now,
      });
      // Should be 17:00 VN time (10:00 UTC)
      expect(next.toISOString()).toBe('2026-11-04T10:00:00.000Z');
    });

    test('rolls over to first fixed time tomorrow when all times today passed', () => {
      // 18:00 VN time (11:00 UTC)
      const now = new Date('2026-11-04T11:00:00.000Z');
      const next = calculateNextRunAt({
        scheduleType: 'FIXED_TIMES',
        fixedTimes: ['10:00', '17:00'],
        timezone: 'Asia/Ho_Chi_Minh',
        now,
      });
      // Should be 10:00 VN time tomorrow (2026-11-05T03:00:00.000Z)
      expect(next.toISOString()).toBe('2026-11-05T03:00:00.000Z');
    });

    test('handles INTERVAL scheduleType correctly', () => {
      const now = new Date('2026-11-04T01:00:00.000Z');
      const next = calculateNextRunAt({
        scheduleType: 'INTERVAL',
        intervalMinutes: 60,
        now,
      });
      expect(next.getTime()).toBe(now.getTime() + 60 * 60 * 1000);
    });

    test('falls back to INTERVAL if fixedTimes is empty', () => {
      const now = new Date('2026-11-04T01:00:00.000Z');
      const next = calculateNextRunAt({
        scheduleType: 'FIXED_TIMES',
        fixedTimes: [],
        intervalMinutes: 120,
        now,
      });
      expect(next.getTime()).toBe(now.getTime() + 120 * 60 * 1000);
    });
  });
});
