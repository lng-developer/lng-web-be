const {
  attendanceSource,
  dateKey,
  normalizeAttendanceStatus,
  normalizeEmployeeStatus,
  normalizeEmploymentType,
  normalizeLeaveType,
  normalizeRequestStatus,
  normalizeWorkMode,
  parseArgs,
  requestedUnits,
} = require('../../../modules/hr/scripts/migrateLngHrData');

describe('migrateLngHrData helpers', () => {
  it('parses dry-run and apply arguments', () => {
    expect(parseArgs([])).toEqual({ apply: false, limit: 0 });
    expect(parseArgs(['--apply', '--limit=10'])).toEqual({ apply: true, limit: 10 });
  });

  it('normalizes legacy employee enum values', () => {
    expect(normalizeEmployeeStatus('Active')).toBe('ACTIVE');
    expect(normalizeEmployeeStatus('Probation')).toBe('PROBATION');
    expect(normalizeEmployeeStatus('Resigned')).toBe('RESIGNED');
    expect(normalizeEmploymentType('Full-time')).toBe('FULL_TIME');
    expect(normalizeWorkMode('Onsite')).toBe('ONSITE');
  });

  it('normalizes legacy request and attendance enum values', () => {
    expect(normalizeRequestStatus('APPROVED')).toBe('APPROVED');
    expect(normalizeRequestStatus('weird')).toBe('PENDING');
    expect(normalizeLeaveType('SICK')).toBe('SICK');
    expect(normalizeLeaveType('weird')).toBe('ANNUAL');
    expect(normalizeAttendanceStatus('SICK_LEAVE')).toBe('SICK_LEAVE');
    expect(normalizeAttendanceStatus('MATERNITY_LEAVE')).toBe('MATERNITY_LEAVE');
    expect(normalizeAttendanceStatus('PATERNITY_LEAVE')).toBe('PATERNITY_LEAVE');
    expect(normalizeAttendanceStatus('ERROR')).toBe('ERROR');
    expect(attendanceSource('WEB_APP')).toBe('SELF_SERVICE');
    expect(attendanceSource('MACHINE')).toBe('MANAGED');
  });

  it('converts dates and leave units', () => {
    expect(dateKey(new Date('2026-07-16T10:00:00.000Z'))).toBe('2026-07-16');
    expect(dateKey('not-a-date')).toBeNull();
    expect(requestedUnits(0.5)).toBe(1);
    expect(requestedUnits(2)).toBe(4);
  });
});
