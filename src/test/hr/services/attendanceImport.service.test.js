jest.mock('../../../modules/auth/public', () => ({}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({}));
jest.mock('../../../modules/hr/repositories/attendance.repository', () => ({}));
jest.mock('../../../modules/hr/services/scheduleResolver.service', () => ({}));

const service = require('../../../modules/hr/services/attendance.service');

function inMemoryDependencies() {
  const records = new Map();
  const batches = new Map();
  const profile = { _id: '660000000000000000000001', employeeCode: 'J2501' };
  return {
    records,
    profileRepository: {
      findByEmployeeCode: async (employeeCode) => (employeeCode === profile.employeeCode ? profile : null),
    },
    attendanceRepository: {
      findByProfileAndWorkDate: async (profileId, dateKey) => records.get(`${profileId}:${dateKey}`) || null,
      createDaily: async (payload) => {
        const record = { _id: '660000000000000000000010', ...payload };
        records.set(`${payload.profileId}:${payload.workDateKey}`, record);
        return record;
      },
      updateById: async (id, patch) => {
        const entry = [...records.entries()].find(([, record]) => record._id === id);
        const updated = { ...entry[1], ...patch };
        records.set(entry[0], updated);
        return updated;
      },
    },
    calendarPolicyService: {
      resolveCalendarPolicy: async () => ({
        isSunday: false,
        isRotationOff: false,
        holiday: null,
        scheduleSnapshot: {
          status: 'WORKING_DAY',
          profile: {},
          workLocation: { id: '660000000000000000000006', timezone: 'Asia/Ho_Chi_Minh' },
          shift: {
            id: '660000000000000000000007',
            startTime: '08:00',
            endTime: '17:30',
            breakMinutes: 90,
            graceMinutes: 0,
            durationMinutes: 570,
            isOvernight: false,
          },
        },
      }),
    },
    batchRepository: {
      findBySourceBatchId: async (id) => batches.get(id) || null,
      start: async (id, punchCount) => {
        const batch = { sourceBatchId: id, status: 'PROCESSING', punchCount };
        batches.set(id, batch);
        return batch;
      },
      complete: async (id, result) => batches.set(id, { ...batches.get(id), status: 'COMPLETED', result }),
      fail: async (id, result) => batches.set(id, { ...batches.get(id), status: 'FAILED', result }),
    },
  };
}

test('a completed source batch persists one day and replays as unchanged punches', async () => {
  const dependencies = inMemoryDependencies();
  const payload = {
    sourceBatchId: 'sql:2026-07-18:1-2',
    punches: [
      { sourceId: '1', employeeCode: 'J2501', occurredAt: '2026-07-18T01:00:00.000Z' },
      { sourceId: '2', employeeCode: 'J2501', occurredAt: '2026-07-18T10:30:00.000Z' },
    ],
  };

  await expect(service.importAttendancePunches(payload, dependencies)).resolves.toEqual({
    inserted: 2, updated: 0, unchanged: 0, failed: 0,
  });
  await expect(service.importAttendancePunches(payload, dependencies)).resolves.toEqual({
    inserted: 0, updated: 0, unchanged: 2, failed: 0,
  });

  expect([...dependencies.records.values()]).toEqual([
    expect.objectContaining({ status: 'PRESENT', workDayValue: 1, calculationReason: 'SWIPE' }),
  ]);
});
