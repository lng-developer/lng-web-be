jest.mock('../../../src/modules/auth/public', () => ({}));
jest.mock('../../../src/modules/hr/repositories/employeeProfile.repository', () => ({}));
jest.mock('../../../src/modules/hr/repositories/attendance.repository', () => ({}));
jest.mock('../../../src/modules/hr/services/scheduleResolver.service', () => ({}));
jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
}));

const auditPublic = require('../../../src/modules/audit/public');
const service = require('../../../src/modules/hr/services/attendance.service');

beforeEach(() => jest.clearAllMocks());

function inMemoryDependencies() {
  const records = new Map();
  const batches = new Map();
  const profile = { _id: '660000000000000000000001', employeeCode: 'J2501' };
  return {
    records,
    batches,
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
    scheduleResolver: {
      resolveWorkContext: async ({ workDateKey }) => ({
        status: 'WORKING_DAY', isWorkingDay: true, workDateKey,
        profile: {}, assignment: null,
        workLocation: { id: '660000000000000000000006', timezone: 'Asia/Ho_Chi_Minh' },
        shift: {
          id: '660000000000000000000007', startTime: '08:00', endTime: '17:30',
          breakMinutes: 90, graceMinutes: 0, durationMinutes: 570, isOvernight: false,
        },
        calendarOverride: null, holiday: null, isRotationOff: false,
      }),
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
      claim: async (id, punchCount) => {
        const current = batches.get(id);
        if (current && current.status !== 'FAILED') return { acquired: false, batch: current };
        const batch = { sourceBatchId: id, status: 'PROCESSING', punchCount };
        batches.set(id, batch);
        return { acquired: true, batch };
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
  expect(auditPublic.record).toHaveBeenCalledTimes(1);
  expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
    actorType: 'SYSTEM',
    action: 'HR_ATTENDANCE_IMPORTED',
    entityType: 'HR_ATTENDANCE_IMPORT_BATCH',
    entityId: payload.sourceBatchId,
    source: 'IMPORT',
    metadata: { inserted: 2, updated: 0, unchanged: 0, failed: 0 },
  }), {});
});

test('later pages extend the saved day instead of replacing its earlier punch', async () => {
  const dependencies = inMemoryDependencies();

  await service.importAttendancePunches({
    sourceBatchId: 'sql:morning',
    punches: [{ sourceId: 'event-1', employeeCode: 'J2501', occurredAt: '2026-07-18T01:00:00.000Z' }],
  }, dependencies);
  await service.importAttendancePunches({
    sourceBatchId: 'sql:evening',
    punches: [{ sourceId: 'event-2', employeeCode: 'J2501', occurredAt: '2026-07-18T10:30:00.000Z' }],
  }, dependencies);

  expect([...dependencies.records.values()]).toEqual([
    expect.objectContaining({
      checkInAt: new Date('2026-07-18T01:00:00.000Z'),
      checkOutAt: new Date('2026-07-18T10:30:00.000Z'),
      status: 'PRESENT',
      workDayValue: 1,
      calculationReason: 'SWIPE',
      sourceBatchIds: ['sql:morning', 'sql:evening'],
    }),
  ]);
});

test('uses the canonical holiday decision when importing punches', async () => {
  const dependencies = inMemoryDependencies();
  dependencies.scheduleResolver.resolveWorkContext = async ({ workDateKey }) => ({
      status: 'HOLIDAY', isWorkingDay: false, workDateKey,
      profile: {},
      workLocation: { id: '660000000000000000000006', timezone: 'Asia/Ho_Chi_Minh' },
      shift: {
        id: '660000000000000000000007', startTime: '08:00', endTime: '17:30',
        breakMinutes: 90, graceMinutes: 0, durationMinutes: 570, isOvernight: false,
      },
      calendarOverride: null,
      holiday: { id: 'holiday-1', holidayType: 'PUBLIC_HOLIDAY', isWorkDay: false },
      isRotationOff: false,
  });

  await service.importAttendancePunches({
    sourceBatchId: 'sql:holiday',
    punches: [{ sourceId: 'event-1', employeeCode: 'J2501', occurredAt: '2026-07-18T01:00:00.000Z' }],
  }, dependencies);

  expect([...dependencies.records.values()]).toEqual([
    expect.objectContaining({ status: 'HOLIDAY', workDayValue: 1 }),
  ]);
});

test('rejects an import batch already being processed', async () => {
  const dependencies = inMemoryDependencies();
  dependencies.batchRepository = {
    claim: jest.fn().mockResolvedValue({ acquired: false, batch: { status: 'PROCESSING' } }),
  };

  await expect(service.importAttendancePunches({
    sourceBatchId: 'sql:processing',
    punches: [{ sourceId: 'event-1', employeeCode: 'J2501', occurredAt: '2026-07-18T01:00:00.000Z' }],
  }, dependencies)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  expect(dependencies.records.size).toBe(0);
});

test('replays a completed import without attendance writes or another audit', async () => {
  const dependencies = inMemoryDependencies();
  dependencies.batchRepository = {
    claim: jest.fn().mockResolvedValue({ acquired: false, batch: { status: 'COMPLETED' } }),
  };

  await expect(service.importAttendancePunches({
    sourceBatchId: 'sql:completed',
    punches: [{ sourceId: 'event-1', employeeCode: 'J2501', occurredAt: '2026-07-18T01:00:00.000Z' }],
  }, dependencies)).resolves.toEqual({ inserted: 0, updated: 0, unchanged: 1, failed: 0 });
  expect(dependencies.records.size).toBe(0);
  expect(auditPublic.record).not.toHaveBeenCalled();
});

test('groups after-midnight punches into the preceding overnight work date', async () => {
  const dependencies = inMemoryDependencies();
  dependencies.scheduleResolver = {
    resolveWorkContext: jest.fn(async ({ workDateKey }) => (workDateKey === '2026-08-10' ? {
      status: 'WORKING_DAY', isWorkingDay: true, workDateKey,
      profile: {}, assignment: { id: '660000000000000000000008' },
      workLocation: { id: '660000000000000000000006', timezone: 'Asia/Ho_Chi_Minh' },
      shift: {
        id: '660000000000000000000007', startTime: '22:00', endTime: '06:00',
        breakMinutes: 0, graceMinutes: 0, durationMinutes: 480, isOvernight: true,
      },
      calendarOverride: null, holiday: null, isRotationOff: false,
    } : { status: 'SCHEDULE_UNRESOLVED', workDateKey })),
  };

  const result = await service.importAttendancePunches({
    sourceBatchId: 'sql:overnight',
    punches: [
      { sourceId: 'event-1', employeeCode: 'J2501', occurredAt: '2026-08-10T15:05:00.000Z' },
      { sourceId: 'event-2', employeeCode: 'J2501', occurredAt: '2026-08-10T22:55:00.000Z' },
    ],
  }, dependencies);

  expect(result).toEqual({ inserted: 2, updated: 0, unchanged: 0, failed: 0 });
  expect([...dependencies.records.values()]).toEqual([
    expect.objectContaining({
      workDateKey: '2026-08-10',
      checkInAt: new Date('2026-08-10T15:05:00.000Z'),
      checkOutAt: new Date('2026-08-10T22:55:00.000Z'),
    }),
  ]);
});

test('counts an unresolved schedule as failed without creating attendance', async () => {
  const dependencies = inMemoryDependencies();
  dependencies.scheduleResolver = {
    resolveWorkContext: jest.fn().mockResolvedValue({ status: 'SCHEDULE_UNRESOLVED' }),
  };

  await expect(service.importAttendancePunches({
    sourceBatchId: 'sql:unresolved',
    punches: [{ sourceId: 'event-1', employeeCode: 'J2501', occurredAt: '2026-08-10T15:05:00.000Z' }],
  }, dependencies)).resolves.toEqual({ inserted: 0, updated: 0, unchanged: 0, failed: 1 });
  expect(dependencies.records.size).toBe(0);
});

test('marks a malformed punch failed instead of leaving its batch processing', async () => {
  const dependencies = inMemoryDependencies();

  await expect(service.importAttendancePunches({
    sourceBatchId: 'sql:malformed',
    punches: [{ sourceId: 'event-1', employeeCode: 'J2501', occurredAt: 'not-a-date' }],
  }, dependencies)).resolves.toEqual({ inserted: 0, updated: 0, unchanged: 0, failed: 1 });
  expect(dependencies.batches.get('sql:malformed')).toMatchObject({ status: 'FAILED' });
});
