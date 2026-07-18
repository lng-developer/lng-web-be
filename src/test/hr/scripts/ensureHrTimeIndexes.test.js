jest.mock('../../../config/database', () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../../../modules/hr/models/leaveRequest.model', () => ({
  aggregate: jest.fn(),
  createIndexes: jest.fn(),
}));
jest.mock('../../../modules/hr/models/overtimeRequest.model', () => ({
  aggregate: jest.fn(),
  createIndexes: jest.fn(),
}));

const { connectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const LeaveRequest = require('../../../modules/hr/models/leaveRequest.model');
const OvertimeRequest = require('../../../modules/hr/models/overtimeRequest.model');
const {
  ensureHrTimeIndexes,
  findMalformedCanonicalKeys,
  runEnsureHrTimeIndexes,
} = require('../../../modules/hr/scripts/ensureHrTimeIndexes');

const target = { host: 'mongo.internal', port: 27017, database: 'lng_portal' };
const overtimeStart = new Date('2026-07-20T01:00:00.000Z');
const overtimeStartMinute = overtimeStart.getTime() / 60000;

function validLeave(overrides = {}) {
  return {
    _id: 'leave-1',
    profileId: 'profile-1',
    portion: 'MORNING',
    workingDateSnapshots: [{ dateKey: '2026-07-20', units: 1 }],
    conflictKeys: ['2026-07-20:MORNING'],
    ...overrides,
  };
}

function validOvertime(overrides = {}) {
  return {
    _id: 'ot-1',
    profileId: 'profile-1',
    plannedStartAt: overtimeStart,
    plannedEndAt: new Date(overtimeStart.getTime() + (2 * 60000)),
    requestedMinutes: 2,
    conflictMinuteKeys: [overtimeStartMinute, overtimeStartMinute + 1],
    ...overrides,
  };
}

describe('ensure HR time indexes script', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    LeaveRequest.aggregate.mockResolvedValue([]);
    OvertimeRequest.aggregate.mockResolvedValue([]);
    LeaveRequest.createIndexes.mockResolvedValue(['leave-index']);
    OvertimeRequest.createIndexes.mockResolvedValue(['overtime-index']);
    connectDatabase.mockResolvedValue({ host: target.host, port: target.port, name: target.database });
  });

  test('fails before creating any index when active leave conflicts are duplicated', async () => {
    LeaveRequest.aggregate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        _id: { profileId: 'profile-1', conflictKey: '2026-07-20:MORNING' },
        count: 2,
        requestIds: ['leave-1', 'leave-2'],
      }]);

    await expect(ensureHrTimeIndexes(target)).rejects.toThrow('active leave conflict keys');
    expect(LeaveRequest.createIndexes).not.toHaveBeenCalled();
    expect(OvertimeRequest.createIndexes).not.toHaveBeenCalled();
  });

  test('fails before creating any index when canonical overtime minutes are duplicated', async () => {
    OvertimeRequest.aggregate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        _id: { profileId: 'profile-1', conflictKey: 29745420 },
        count: 2,
        requestIds: ['ot-1', 'ot-2'],
      }]);

    await expect(ensureHrTimeIndexes(target)).rejects.toThrow('active overtime conflict minutes');
    expect(LeaveRequest.createIndexes).not.toHaveBeenCalled();
    expect(OvertimeRequest.createIndexes).not.toHaveBeenCalled();
  });

  test('fails before creating any index when an active request has malformed canonical keys', async () => {
    OvertimeRequest.aggregate
      .mockResolvedValueOnce([{
        _id: 'ot-1',
        profileId: 'profile-1',
        conflictMinuteKeys: [29745420, null],
      }])
      .mockResolvedValueOnce([]);

    await expect(ensureHrTimeIndexes(target)).rejects.toThrow('malformed canonical conflict keys');
    expect(LeaveRequest.createIndexes).not.toHaveBeenCalled();
    expect(OvertimeRequest.createIndexes).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', {}],
    ['null', { conflictKeys: null }],
    ['empty', { conflictKeys: [] }],
    ['wrong array type', { conflictKeys: '2026-07-20:MORNING' }],
    ['wrong entry type', { conflictKeys: [123] }],
    ['empty string', { conflictKeys: [''] }],
    ['blank string', { conflictKeys: ['   '] }],
    ['partially invalid', { conflictKeys: ['2026-07-20:MORNING', null] }],
  ])('detects %s leave conflict keys', async (_label, request) => {
    LeaveRequest.aggregate.mockResolvedValue([{ _id: 'leave-1', profileId: 'profile-1', ...request }]);
    await expect(findMalformedCanonicalKeys(LeaveRequest, 'conflictKeys', 'leave')).resolves.toHaveLength(1);
  });

  test.each([
    ['missing', {}],
    ['null', { conflictMinuteKeys: null }],
    ['empty', { conflictMinuteKeys: [] }],
    ['wrong array type', { conflictMinuteKeys: 29745420 }],
    ['wrong entry type', { conflictMinuteKeys: ['29745420'] }],
    ['NaN', { conflictMinuteKeys: [Number.NaN] }],
    ['infinite', { conflictMinuteKeys: [Number.POSITIVE_INFINITY] }],
    ['fractional', { conflictMinuteKeys: [29745420.5] }],
    ['partially invalid', { conflictMinuteKeys: [29745420, null] }],
  ])('detects %s overtime conflict minutes', async (_label, request) => {
    OvertimeRequest.aggregate.mockResolvedValue([{ _id: 'ot-1', profileId: 'profile-1', ...request }]);
    await expect(
      findMalformedCanonicalKeys(OvertimeRequest, 'conflictMinuteKeys', 'overtime'),
    ).resolves.toHaveLength(1);
  });

  test('accepts only nonempty leave strings and finite integer overtime minutes', async () => {
    LeaveRequest.aggregate.mockResolvedValue([validLeave()]);
    OvertimeRequest.aggregate.mockResolvedValue([validOvertime()]);
    await expect(findMalformedCanonicalKeys(LeaveRequest, 'conflictKeys', 'leave')).resolves.toEqual([]);
    await expect(
      findMalformedCanonicalKeys(OvertimeRequest, 'conflictMinuteKeys', 'overtime'),
    ).resolves.toEqual([]);
  });

  test.each([
    ['invalid calendar date', validLeave({ conflictKeys: ['2026-02-30:MORNING'] })],
    ['invalid portion suffix', validLeave({ conflictKeys: ['2026-07-20:FULL_DAY'] })],
    ['snapshot date mismatch', validLeave({ conflictKeys: ['2026-07-21:MORNING'] })],
    ['request portion mismatch', validLeave({ conflictKeys: ['2026-07-20:AFTERNOON'] })],
    ['missing full-day segment', validLeave({
      portion: 'FULL_DAY',
      workingDateSnapshots: [{ dateKey: '2026-07-20', units: 2 }],
      conflictKeys: ['2026-07-20:MORNING'],
    })],
    ['snapshot unit mismatch', validLeave({
      workingDateSnapshots: [{ dateKey: '2026-07-20', units: 2 }],
    })],
  ])('rejects semantic leave mismatch: %s', async (_label, request) => {
    LeaveRequest.aggregate.mockResolvedValue([request]);
    await expect(findMalformedCanonicalKeys(LeaveRequest, 'conflictKeys', 'leave')).resolves.toHaveLength(1);
  });

  test.each([
    ['negative epoch minute', validOvertime({ conflictMinuteKeys: [-1, 0] })],
    ['range starts late', validOvertime({ conflictMinuteKeys: [overtimeStartMinute + 1] })],
    ['range has a gap', validOvertime({
      plannedEndAt: new Date(overtimeStart.getTime() + (3 * 60000)),
      requestedMinutes: 3,
      conflictMinuteKeys: [overtimeStartMinute, overtimeStartMinute + 2],
    })],
    ['range includes end minute', validOvertime({
      conflictMinuteKeys: [overtimeStartMinute, overtimeStartMinute + 1, overtimeStartMinute + 2],
    })],
    ['requested minutes mismatch', validOvertime({ requestedMinutes: 3 })],
    ['non-minute-aligned start', validOvertime({
      plannedStartAt: new Date(overtimeStart.getTime() + 1000),
    })],
  ])('rejects semantic overtime mismatch: %s', async (_label, request) => {
    OvertimeRequest.aggregate.mockResolvedValue([request]);
    await expect(
      findMalformedCanonicalKeys(OvertimeRequest, 'conflictMinuteKeys', 'overtime'),
    ).resolves.toHaveLength(1);
  });

  test('creates schema indexes only after both duplicate checks pass and is rerunnable', async () => {
    await expect(ensureHrTimeIndexes(target)).resolves.toEqual({
      target,
      leaveIndexes: ['leave-index'],
      overtimeIndexes: ['overtime-index'],
    });
    await expect(ensureHrTimeIndexes(target)).resolves.toEqual({
      target,
      leaveIndexes: ['leave-index'],
      overtimeIndexes: ['overtime-index'],
    });

    expect(LeaveRequest.createIndexes).toHaveBeenCalledTimes(2);
    expect(OvertimeRequest.createIndexes).toHaveBeenCalledTimes(2);
    const leavePipeline = LeaveRequest.aggregate.mock.calls[1][0];
    const overtimePipeline = OvertimeRequest.aggregate.mock.calls[1][0];
    expect(leavePipeline).toEqual(expect.arrayContaining([
      { $match: { status: { $in: ['PENDING', 'APPROVED'] } } },
      { $unwind: '$conflictKeys' },
    ]));
    expect(overtimePipeline).toEqual(expect.arrayContaining([
      { $match: { status: { $in: ['PENDING', 'APPROVED'] } } },
      { $unwind: '$conflictMinuteKeys' },
    ]));
  });

  test('logs and returns the exact safe Mongo target before creating indexes', async () => {
    const result = await runEnsureHrTimeIndexes();

    expect(result.target).toEqual(target);
    expect(logger.info).toHaveBeenCalledWith('HR time index target', { target });
    expect(logger.info.mock.invocationCallOrder[0]).toBeLessThan(
      LeaveRequest.createIndexes.mock.invocationCallOrder[0],
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/mongodb:|password|username/i);
  });
});
