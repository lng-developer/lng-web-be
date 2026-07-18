const {
  hrAttendanceStatuses,
  hrCalendarOverrideKinds,
  hrLeaveTypes,
  hrRequestStatuses,
  hrTimePermissions,
} = require('../../../modules/hr/constants/hr.constants');

describe('HR time constants', () => {
  test('exports time operation permissions', () => {
    expect(hrTimePermissions).toEqual(expect.objectContaining({
      SCHEDULE_READ: 'HR_SCHEDULE:READ',
      ATTENDANCE_MANAGE: 'HR_ATTENDANCE:MANAGE',
      LEAVE_APPROVE: 'HR_LEAVE:APPROVE',
      OVERTIME_APPROVE: 'HR_OVERTIME:APPROVE',
    }));
  });

  test('exports immutable time workflow value sets', () => {
    expect(hrAttendanceStatuses).toBeDefined();
    expect(hrAttendanceStatuses.MIXED_LEAVE).toBe('MIXED_LEAVE');
    expect(hrRequestStatuses).toBeDefined();
    expect(hrLeaveTypes).toBeDefined();
    expect(hrCalendarOverrideKinds).toBeDefined();
    expect(Object.isFrozen(hrAttendanceStatuses)).toBe(true);
    expect(Object.isFrozen(hrRequestStatuses)).toBe(true);
    expect(Object.isFrozen(hrLeaveTypes)).toBe(true);
    expect(Object.isFrozen(hrCalendarOverrideKinds)).toBe(true);
  });
});
