const AttendanceDaily = require('../../../src/modules/hr/models/attendanceDaily.model');

describe('HrAttendanceDaily model', () => {
  test('has one attendance row per profile and work date', () => {
    expect(AttendanceDaily.schema.indexes()).toContainEqual([
      { profileId: 1, workDateKey: 1 },
      { unique: true },
    ]);
  });

  test('stores schedule snapshots and append-only manual adjustment history', () => {
    const paths = AttendanceDaily.schema.paths;

    expect(paths.scheduleSnapshot).toBeDefined();
    expect(paths.manualAdjustments).toBeDefined();
    expect(paths.checkInAt).toBeDefined();
    expect(paths.checkOutAt).toBeDefined();
    expect(paths.lateMinutes).toBeDefined();
    expect(paths.earlyLeaveMinutes).toBeDefined();
    expect(paths.workedMinutes).toBeDefined();
  });
});
