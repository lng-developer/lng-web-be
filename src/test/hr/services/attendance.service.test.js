jest.mock('mongoose', () => ({
  startSession: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/attendance.repository', () => ({
  appendAdjustment: jest.fn(),
  closeOpenById: jest.fn(),
  createDaily: jest.fn(),
  findById: jest.fn(),
  findByProfileAndWorkDate: jest.fn(),
  findByLeaveRequestId: jest.fn(),
  findOpenByProfile: jest.fn(),
  list: jest.fn(),
  removeById: jest.fn(),
  updateLeaveProjection: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../../../modules/hr/services/scheduleResolver.service', () => ({
  resolveWorkContext: jest.fn(),
}));
jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  getCurrentAccount: jest.fn(),
}));

const mongoose = require('mongoose');
const authPublic = require('../../../modules/auth/public');
const profileRepository = require('../../../modules/hr/repositories/employeeProfile.repository');
const repository = require('../../../modules/hr/repositories/attendance.repository');
const resolver = require('../../../modules/hr/services/scheduleResolver.service');
const service = require('../../../modules/hr/services/attendance.service');

const profileId = '660000000000000000000001';
const accountId = '660000000000000000000002';
const auth = {
  accountId,
  permissions: ['HR_ATTENDANCE:WRITE'],
  scopes: [],
};
const profile = {
  _id: profileId,
  accountId,
  fullName: 'Test Employee',
  departmentId: '660000000000000000000003',
  teamId: '660000000000000000000004',
  status: 'ACTIVE',
  isDeleted: false,
};

function savedScheduleSnapshot() {
  return {
    assignmentId: '660000000000000000000005',
    departmentId: '660000000000000000000003',
    teamId: '660000000000000000000004',
    timezone: 'Asia/Ho_Chi_Minh',
    calendarStatus: 'WORKING_DAY',
    workLocation: { id: '660000000000000000000006', code: 'HCM', name: 'HCM Office' },
    shift: {
      id: '660000000000000000000007',
      code: 'DAY',
      name: 'Day',
      startTime: '08:00',
      endTime: '17:00',
      breakMinutes: 60,
      graceMinutes: 5,
      durationMinutes: 540,
      isOvernight: false,
    },
    calendarOverride: null,
  };
}

function approvedLeave(overrides = {}) {
  return {
    _id: '660000000000000000000030',
    profileId,
    attendanceStatus: 'PAID_LEAVE',
    portion: 'FULL_DAY',
    workingDateSnapshots: [
      { dateKey: '2026-07-18', units: 2, scheduleSnapshot: savedScheduleSnapshot() },
    ],
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    status: 'WORKING_DAY',
    isWorkingDay: true,
    profileId,
    workDateKey: '2026-07-18',
    profile: {
      departmentId: '660000000000000000000003',
      teamId: '660000000000000000000004',
    },
    assignment: { id: '660000000000000000000005' },
    workLocation: {
      id: '660000000000000000000006',
      code: 'HCM',
      name: 'HCM Office',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    shift: {
      id: '660000000000000000000007',
      code: 'DAY',
      name: 'Day',
      startTime: '08:00',
      endTime: '17:00',
      breakMinutes: 60,
      graceMinutes: 5,
      durationMinutes: 540,
      isOvernight: false,
    },
    calendarOverride: null,
    ...overrides,
  };
}

describe('attendance service', () => {
  afterEach(() => jest.useRealTimers());

  beforeEach(() => {
    jest.clearAllMocks();
    profileRepository.findByAccountId.mockResolvedValue(profile);
    repository.findOpenByProfile.mockResolvedValue(null);
    repository.findByProfileAndWorkDate.mockResolvedValue(null);
    repository.createDaily.mockImplementation(async (payload) => ({ _id: '660000000000000000000010', ...payload }));
    repository.updateLeaveProjection.mockImplementation(async (_id, patch) => ({
      _id,
      profileId,
      workDateKey: '2026-07-18',
      ...patch,
    }));
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    mongoose.startSession.mockResolvedValue(session);
  });

  test('rejects check-in without an effective working schedule', async () => {
    resolver.resolveWorkContext.mockResolvedValue({ status: 'SCHEDULE_UNRESOLVED' });

    await expect(service.checkIn(auth, { occurredAt: '2026-07-18T01:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  });

  test('rejects check-in on a holiday or rest day', async () => {
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => (
      workDateKey === '2026-07-18'
        ? context({ status: 'HOLIDAY', isWorkingDay: false })
        : { status: 'SCHEDULE_UNRESOLVED', workDateKey }
    ));

    await expect(service.checkIn(auth, { occurredAt: '2026-07-18T01:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
    expect(repository.createDaily).not.toHaveBeenCalled();
  });

  test('rejects check-in while a stale attendance record is still open', async () => {
    repository.findOpenByProfile.mockResolvedValue({
      _id: '660000000000000000000011',
      profileId,
      workDateKey: '2026-07-15',
      checkInAt: new Date('2026-07-15T01:00:00.000Z'),
      checkOutAt: null,
    });
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => (
      workDateKey === '2026-07-18' ? context() : { status: 'SCHEDULE_UNRESOLVED', workDateKey }
    ));

    await expect(service.checkIn(auth, { occurredAt: '2026-07-18T01:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    expect(resolver.resolveWorkContext).not.toHaveBeenCalled();
    expect(repository.createDaily).not.toHaveBeenCalled();
  });

  test('creates one self-service daily row with a frozen schedule snapshot', async () => {
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => (
      workDateKey === '2026-07-18' ? context() : { status: 'SCHEDULE_UNRESOLVED', workDateKey }
    ));

    const result = await service.checkIn(auth, { occurredAt: '2026-07-18T01:10:00.000Z' });

    expect(repository.createDaily).toHaveBeenCalledWith(expect.objectContaining({
      profileId,
      workDateKey: '2026-07-18',
      status: 'ERROR',
      workDayValue: 0,
      calculationReason: 'SWIPE',
      source: 'SELF_SERVICE',
      isManualEdited: false,
      checkInAt: new Date('2026-07-18T01:10:00.000Z'),
      lateMinutes: 5,
      scheduleSnapshot: expect.objectContaining({
        departmentId: '660000000000000000000003',
        teamId: '660000000000000000000004',
        timezone: 'Asia/Ho_Chi_Minh',
        plannedStartAt: new Date('2026-07-18T01:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T10:00:00.000Z'),
      }),
    }));
    expect(result.id).toBe('660000000000000000000010');
  });

  test('rejects duplicate check-in and an approved leave day', async () => {
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => (
      workDateKey === '2026-07-18' ? context() : { status: 'SCHEDULE_UNRESOLVED', workDateKey }
    ));
    repository.findByProfileAndWorkDate.mockResolvedValueOnce({ status: 'PRESENT', checkInAt: new Date() });
    await expect(service.checkIn(auth, { occurredAt: '2026-07-18T01:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    repository.findByProfileAndWorkDate.mockResolvedValueOnce({ status: 'PAID_LEAVE' });
    await expect(service.checkIn(auth, { occurredAt: '2026-07-18T01:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  });

  test('allows check-in on a half-day leave row and preserves its request projection', async () => {
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => (
      workDateKey === '2026-07-18' ? context() : { status: 'SCHEDULE_UNRESOLVED', workDateKey }
    ));
    const leaveSegments = [{
      requestId: '660000000000000000000030',
      portion: 'MORNING',
      units: 1,
      attendanceStatus: 'PAID_LEAVE',
    }];
    repository.findByProfileAndWorkDate.mockResolvedValue({
      _id: '660000000000000000000031',
      profileId,
      workDateKey: '2026-07-18',
      status: 'HALF_DAY',
      checkInAt: null,
      checkOutAt: null,
      source: 'LEAVE_RECONCILIATION',
      scheduleSnapshot: {
        ...savedScheduleSnapshot(),
        plannedStartAt: new Date('2026-07-18T01:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T10:00:00.000Z'),
      },
      leaveSegments,
    });
    repository.updateLeaveProjection.mockResolvedValue({
      _id: '660000000000000000000031',
      profileId,
      workDateKey: '2026-07-18',
      status: 'HALF_DAY',
      checkInAt: new Date('2026-07-18T05:00:00.000Z'),
      checkOutAt: null,
      source: 'SELF_SERVICE',
      scheduleSnapshot: savedScheduleSnapshot(),
      leaveSegments,
    });

    const result = await service.checkIn(auth, { occurredAt: '2026-07-18T05:00:00.000Z' });

    expect(repository.updateLeaveProjection).toHaveBeenCalledWith(
      '660000000000000000000031',
      expect.objectContaining({
        status: 'PAID_LEAVE',
        workDayValue: 0.4375,
        source: 'SELF_SERVICE',
        checkInAt: new Date('2026-07-18T05:00:00.000Z'),
      }),
      expect.objectContaining({ requireAvailableHalfDay: true }),
    );
    expect(result.leaveSegments).toEqual(leaveSegments);
    expect(repository.createDaily).not.toHaveBeenCalled();
  });

  test('computes morning-leave check-in lateness from the afternoon work window', async () => {
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => (
      workDateKey === '2026-07-18' ? context() : { status: 'SCHEDULE_UNRESOLVED', workDateKey }
    ));
    const leaveSegments = [{
      requestId: '660000000000000000000030',
      portion: 'MORNING',
      units: 1,
      attendanceStatus: 'PAID_LEAVE',
    }];
    repository.findByProfileAndWorkDate.mockResolvedValue({
      _id: '660000000000000000000031',
      profileId,
      workDateKey: '2026-07-18',
      status: 'HALF_DAY',
      checkInAt: null,
      checkOutAt: null,
      source: 'LEAVE_RECONCILIATION',
      scheduleSnapshot: {
        ...savedScheduleSnapshot(),
        plannedStartAt: new Date('2026-07-18T01:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T10:00:00.000Z'),
      },
      leaveSegments,
    });
    repository.updateLeaveProjection.mockImplementation(async (_id, patch) => ({
      _id: '660000000000000000000031',
      profileId,
      workDateKey: '2026-07-18',
      scheduleSnapshot: savedScheduleSnapshot(),
      leaveSegments,
      ...patch,
    }));

    await service.checkIn(auth, { occurredAt: '2026-07-18T06:10:00.000Z' });

    expect(repository.updateLeaveProjection).toHaveBeenCalledWith(
      '660000000000000000000031',
      expect.objectContaining({ lateMinutes: 5 }),
      expect.objectContaining({ requireAvailableHalfDay: true }),
    );
  });

  test('computes afternoon-leave checkout from the morning work window', async () => {
    const leaveSegments = [{
      requestId: '660000000000000000000030',
      portion: 'AFTERNOON',
      units: 1,
      attendanceStatus: 'PAID_LEAVE',
    }];
    repository.findOpenByProfile.mockResolvedValue({
      _id: '660000000000000000000031',
      profileId,
      workDateKey: '2026-07-18',
      status: 'HALF_DAY',
      checkInAt: new Date('2026-07-18T01:00:00.000Z'),
      checkOutAt: null,
      scheduleSnapshot: {
        ...savedScheduleSnapshot(),
        plannedStartAt: new Date('2026-07-18T01:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T10:00:00.000Z'),
      },
      leaveSegments,
    });
    repository.closeOpenById.mockImplementation(async (_id, patch) => ({
      _id: '660000000000000000000031',
      profileId,
      workDateKey: '2026-07-18',
      status: 'HALF_DAY',
      checkInAt: new Date('2026-07-18T01:00:00.000Z'),
      scheduleSnapshot: savedScheduleSnapshot(),
      leaveSegments,
      ...patch,
    }));

    await service.checkOut(auth, { occurredAt: '2026-07-18T05:00:00.000Z' });

    expect(repository.closeOpenById).toHaveBeenCalledWith(
      '660000000000000000000031',
      expect.objectContaining({
        earlyLeaveMinutes: 0,
        workedMinutes: 240,
        status: 'PAID_LEAVE',
        workDayValue: 1,
        calculationReason: 'APPROVED_LEAVE',
      }),
    );
  });

  test('blocks check-in when complementary leave segments cover the full day', async () => {
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => (
      workDateKey === '2026-07-18' ? context() : { status: 'SCHEDULE_UNRESOLVED', workDateKey }
    ));
    repository.findByProfileAndWorkDate.mockResolvedValue({
      _id: '660000000000000000000031',
      status: 'HALF_DAY',
      checkInAt: null,
      checkOutAt: null,
      leaveSegments: [
        { requestId: '660000000000000000000030', portion: 'MORNING', units: 1, attendanceStatus: 'PAID_LEAVE' },
        { requestId: '660000000000000000000033', portion: 'AFTERNOON', units: 1, attendanceStatus: 'UNPAID_LEAVE' },
      ],
    });

    await expect(service.checkIn(auth, { occurredAt: '2026-07-18T05:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    expect(repository.updateLeaveProjection).not.toHaveBeenCalled();
  });

  test('closes only the immediately preceding overnight attendance row', async () => {
    repository.findOpenByProfile.mockResolvedValue({
      _id: '660000000000000000000011',
      profileId,
      workDateKey: '2026-07-18',
      checkInAt: new Date('2026-07-18T15:00:00.000Z'),
      checkOutAt: null,
      scheduleSnapshot: {
        timezone: 'Asia/Ho_Chi_Minh',
        plannedStartAt: new Date('2026-07-18T15:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T23:00:00.000Z'),
        shift: { isOvernight: true, breakMinutes: 0 },
      },
    });
    repository.closeOpenById.mockImplementation(async (_id, update) => ({
      _id: '660000000000000000000011',
      profileId,
      workDateKey: '2026-07-18',
      checkInAt: new Date('2026-07-18T15:00:00.000Z'),
      scheduleSnapshot: { timezone: 'Asia/Ho_Chi_Minh', shift: { isOvernight: true } },
      ...update,
    }));

    const result = await service.checkOut(auth, { occurredAt: '2026-07-18T23:15:00.000Z' });

    expect(repository.closeOpenById).toHaveBeenCalledWith(
      '660000000000000000000011',
      expect.objectContaining({ checkOutAt: new Date('2026-07-18T23:15:00.000Z'), workedMinutes: 495 }),
    );
    expect(result.checkOutAt).toEqual(new Date('2026-07-18T23:15:00.000Z'));

    repository.findOpenByProfile.mockResolvedValue({
      _id: '660000000000000000000012',
      profileId,
      workDateKey: '2026-07-17',
      checkInAt: new Date('2026-07-17T15:00:00.000Z'),
      scheduleSnapshot: { timezone: 'Asia/Ho_Chi_Minh', shift: { isOvernight: true, breakMinutes: 0 } },
    });
    await expect(service.checkOut(auth, { occurredAt: '2026-07-18T23:15:00.000Z' }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  });

  test('rejects a concurrent second check-out when the open-row claim is lost', async () => {
    repository.findOpenByProfile.mockResolvedValue({
      _id: '660000000000000000000015',
      profileId,
      workDateKey: '2026-07-18',
      checkInAt: new Date('2026-07-18T01:00:00.000Z'),
      checkOutAt: null,
      scheduleSnapshot: {
        timezone: 'Asia/Ho_Chi_Minh',
        plannedStartAt: new Date('2026-07-18T01:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T10:00:00.000Z'),
        shift: { isOvernight: false, breakMinutes: 60 },
      },
    });
    repository.closeOpenById.mockResolvedValue(null);

    await expect(service.checkOut(auth, { occurredAt: '2026-07-18T10:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  });

  test('limits management list to granted team and department scopes', async () => {
    const manager = {
      accountId: '660000000000000000000020',
      permissions: [],
      scopes: [
        { scopeType: 'team', scopeId: '660000000000000000000004', permissions: ['HR_ATTENDANCE:READ'] },
        { scopeType: 'department', scopeId: '660000000000000000000003', permissions: ['HR_ATTENDANCE:READ'] },
      ],
    };
    repository.list.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0 } });

    await service.listAttendance({ page: 1, limit: 20 }, manager);

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      scopeFilters: expect.arrayContaining([
        { 'scheduleSnapshot.teamId': '660000000000000000000004' },
        { 'scheduleSnapshot.departmentId': '660000000000000000000003' },
      ]),
    }));
  });

  test('returns summary counts from the full filtered result set', async () => {
    const summary = {
      total: 3,
      statusCounts: {
        PRESENT: 1,
        ABSENT: 1,
        PAID_LEAVE: 1,
        UNPAID_LEAVE: 0,
        MIXED_LEAVE: 0,
        HALF_DAY: 0,
        HOLIDAY: 0,
        REST_DAY: 0,
      },
    };
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000040',
        profileId,
        status: 'PRESENT',
        scheduleSnapshot: savedScheduleSnapshot(),
      }],
      pagination: { page: 1, limit: 1, total: 3 },
      summary,
    });

    const result = await service.listAttendance({ page: 1, limit: 1 }, {
      accountId,
      permissions: ['HR_ATTENDANCE:READ'],
      scopes: [],
    });

    expect(result.summary).toEqual(summary);
  });

  test('returns check-out capability for an open preceding overnight record', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T23:15:00.000Z'));
    repository.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0 },
    });
    repository.findOpenByProfile.mockResolvedValue({
      _id: '660000000000000000000011',
      profileId,
      workDateKey: '2026-07-18',
      checkInAt: new Date('2026-07-18T15:00:00.000Z'),
      checkOutAt: null,
      scheduleSnapshot: {
        timezone: 'Asia/Ho_Chi_Minh',
        shift: { isOvernight: true },
      },
    });

    const result = await service.listAttendance({
      own: true,
      dateFrom: '2026-07-19',
      dateTo: '2026-07-19',
    }, auth);

    expect(result.capabilities).toEqual({ checkIn: false, checkOut: true });
    expect(resolver.resolveWorkContext).not.toHaveBeenCalled();
  });

  test('does not offer check-in when a stale open attendance record needs correction', async () => {
    repository.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0 },
    });
    repository.findOpenByProfile.mockResolvedValue({
      _id: '660000000000000000000011',
      profileId,
      workDateKey: '2026-07-15',
      checkInAt: new Date('2026-07-15T01:00:00.000Z'),
      checkOutAt: null,
      scheduleSnapshot: {
        timezone: 'Asia/Ho_Chi_Minh',
        shift: { isOvernight: false },
      },
    });

    const result = await service.listAttendance({ own: true }, auth);

    expect(result.capabilities).toEqual({ checkIn: false, checkOut: false });
    expect(resolver.resolveWorkContext).not.toHaveBeenCalled();
  });

  test('returns no self-attendance action on a rest day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    repository.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0 },
    });
    repository.findOpenByProfile.mockResolvedValue(null);
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => (
      workDateKey === '2026-07-18'
        ? context({ status: 'REST_DAY', isWorkingDay: false })
        : { status: 'SCHEDULE_UNRESOLVED', workDateKey }
    ));

    const result = await service.listAttendance({
      own: true,
      dateFrom: '2026-07-18',
      dateTo: '2026-07-18',
    }, auth);

    expect(result.capabilities).toEqual({ checkIn: false, checkOut: false });
    expect(repository.findByProfileAndWorkDate).not.toHaveBeenCalled();
  });

  test('manual adjustment requires scope and appends actor, reason, before, and after', async () => {
    const current = {
      _id: '660000000000000000000013',
      profileId,
      workDateKey: '2026-07-18',
      status: 'PRESENT',
      checkInAt: new Date('2026-07-18T01:10:00.000Z'),
      checkOutAt: null,
      scheduleSnapshot: {
        departmentId: '660000000000000000000003',
        teamId: '660000000000000000000004',
        timezone: 'Asia/Ho_Chi_Minh',
        plannedStartAt: new Date('2026-07-18T01:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T10:00:00.000Z'),
        shift: { breakMinutes: 60 },
      },
      manualAdjustments: [],
      updatedAt: new Date('2026-07-18T11:00:00.000Z'),
    };
    const manager = { accountId, permissions: ['HR_ATTENDANCE:MANAGE'], scopes: [] };
    repository.findById.mockResolvedValue(current);
    authPublic.canAccessScope.mockReturnValue(true);
    repository.appendAdjustment.mockImplementation(async (_id, _expectedUpdatedAt, update, adjustment) => ({
      ...current,
      ...update,
      manualAdjustments: [adjustment],
    }));

    const result = await service.adjustAttendance(current._id, {
      checkOutAt: '2026-07-18T10:30:00.000Z',
      reason: 'Forgot to check out',
    }, manager);

    expect(repository.appendAdjustment).toHaveBeenCalledWith(
      current._id,
      new Date('2026-07-18T11:00:00.000Z'),
      expect.objectContaining({
        checkOutAt: new Date('2026-07-18T10:30:00.000Z'),
        source: 'MANAGED',
        isManualEdited: true,
        calculationReason: 'MANUAL',
      }),
      expect.objectContaining({
        actorId: accountId,
        actorName: 'Test Employee',
        reason: 'Forgot to check out',
        before: expect.objectContaining({ checkOutAt: null }),
        after: expect.objectContaining({ checkOutAt: new Date('2026-07-18T10:30:00.000Z') }),
      }),
    );
    expect(result.manualAdjustments).toHaveLength(1);
  });

  test('allows a global attendance manager without an HR employee profile and snapshots the Auth name', async () => {
    const current = {
      _id: '660000000000000000000014',
      profileId,
      workDateKey: '2026-07-18',
      status: 'ABSENT',
      checkInAt: null,
      checkOutAt: null,
      scheduleSnapshot: {
        departmentId: '660000000000000000000003',
        teamId: '660000000000000000000004',
        timezone: 'Asia/Ho_Chi_Minh',
        plannedStartAt: new Date('2026-07-18T01:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T10:00:00.000Z'),
        shift: { breakMinutes: 60 },
      },
      manualAdjustments: [],
      updatedAt: new Date('2026-07-18T11:00:00.000Z'),
    };
    const manager = { accountId: '660000000000000000000020', permissions: ['HR_ATTENDANCE:MANAGE'], scopes: [] };
    profileRepository.findByAccountId.mockResolvedValue(null);
    authPublic.getCurrentAccount.mockResolvedValue({ profile: { fullName: 'HR Admin' } });
    authPublic.canAccessScope.mockReturnValue(true);
    repository.findById.mockResolvedValue(current);
    repository.appendAdjustment.mockImplementation(async (_id, _expectedUpdatedAt, update, adjustment) => ({
      ...current,
      ...update,
      manualAdjustments: [adjustment],
    }));

    await service.adjustAttendance(current._id, { status: 'PAID_LEAVE', reason: 'Approved correction' }, manager);

    expect(repository.appendAdjustment).toHaveBeenCalledWith(
      current._id,
      new Date('2026-07-18T11:00:00.000Z'),
      expect.any(Object),
      expect.objectContaining({ actorName: 'HR Admin' }),
    );
  });

  test('rejects a stale manual adjustment without appending misleading history', async () => {
    const current = {
      _id: '660000000000000000000016',
      profileId,
      workDateKey: '2026-07-18',
      status: 'PRESENT',
      checkInAt: new Date('2026-07-18T01:00:00.000Z'),
      checkOutAt: null,
      scheduleSnapshot: {
        departmentId: '660000000000000000000003',
        teamId: '660000000000000000000004',
        timezone: 'Asia/Ho_Chi_Minh',
        plannedStartAt: new Date('2026-07-18T01:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T10:00:00.000Z'),
        shift: { breakMinutes: 60 },
      },
      manualAdjustments: [],
      updatedAt: new Date('2026-07-18T11:00:00.000Z'),
    };
    const manager = { accountId, permissions: ['HR_ATTENDANCE:MANAGE'], scopes: [] };
    repository.findById.mockResolvedValue(current);
    authPublic.canAccessScope.mockReturnValue(true);
    repository.appendAdjustment.mockResolvedValue(null);

    await expect(service.adjustAttendance(current._id, {
      checkOutAt: '2026-07-18T10:30:00.000Z',
      reason: 'Forgot to check out',
    }, manager)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    expect(repository.appendAdjustment).toHaveBeenCalledWith(
      current._id,
      current.updatedAt,
      expect.any(Object),
      expect.any(Object),
    );
  });

  test('reconciles from the saved snapshot and stores full-day request linkage atomically', async () => {
    repository.createDaily.mockImplementation(async (payload, options) => ({
      _id: '660000000000000000000032', ...payload, sessionSeen: options.session,
    }));
    const session = { id: 'approval-session' };

    const result = await service.reconcileApprovedLeave(approvedLeave(), { session });

    expect(resolver.resolveWorkContext).not.toHaveBeenCalled();
    expect(repository.createDaily).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PAID_LEAVE',
      workDayValue: 1,
      calculationReason: 'APPROVED_LEAVE',
      source: 'LEAVE_RECONCILIATION',
      scheduleSnapshot: expect.objectContaining({
        plannedStartAt: new Date('2026-07-18T01:00:00.000Z'),
        plannedEndAt: new Date('2026-07-18T10:00:00.000Z'),
      }),
      leaveSegments: [{
        requestId: '660000000000000000000030',
        portion: 'FULL_DAY',
        units: 2,
        attendanceStatus: 'PAID_LEAVE',
      }],
    }), { session });
    expect(result).toHaveLength(1);
  });

  test('projects half-day value and permits the complementary AM/PM segment only', async () => {
    const morning = approvedLeave({ portion: 'MORNING' });
    morning.workingDateSnapshots[0].units = 1;
    repository.createDaily.mockImplementation(async (payload) => ({
      _id: '660000000000000000000032', ...payload,
    }));

    await service.reconcileApprovedLeave(morning, { session: { id: 'session' } });

    expect(repository.createDaily).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PAID_LEAVE',
      workDayValue: 0.4375,
      leaveSegments: [expect.objectContaining({ portion: 'MORNING', units: 1 })],
    }), expect.any(Object));

    repository.createDaily.mockClear();
    repository.findByProfileAndWorkDate.mockResolvedValue({
      _id: '660000000000000000000032',
      profileId,
      workDateKey: '2026-07-18',
      status: 'HALF_DAY',
      source: 'LEAVE_RECONCILIATION',
      checkInAt: null,
      checkOutAt: null,
      scheduleSnapshot: savedScheduleSnapshot(),
      leaveSegments: [{
        requestId: '660000000000000000000030',
        portion: 'MORNING',
        units: 1,
        attendanceStatus: 'PAID_LEAVE',
      }],
    });
    const afternoon = approvedLeave({
      _id: '660000000000000000000033',
      portion: 'AFTERNOON',
      attendanceStatus: 'UNPAID_LEAVE',
    });
    afternoon.workingDateSnapshots[0].units = 1;

    await service.reconcileApprovedLeave(afternoon, { session: { id: 'session' } });

    expect(repository.updateLeaveProjection).toHaveBeenCalledWith(
      '660000000000000000000032',
      expect.objectContaining({
        status: 'MIXED_LEAVE',
        leaveSegments: expect.arrayContaining([
          expect.objectContaining({ portion: 'MORNING' }),
          expect.objectContaining({ portion: 'AFTERNOON' }),
        ]),
      }),
      expect.any(Object),
    );

    const duplicateMorning = approvedLeave({ _id: '660000000000000000000034', portion: 'MORNING' });
    duplicateMorning.workingDateSnapshots[0].units = 1;
    await expect(service.reconcileApprovedLeave(duplicateMorning, { session: { id: 'session' } }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  });

  test('rejects leave reconciliation without an allowed explicit attendance status', async () => {
    await expect(service.reconcileApprovedLeave(approvedLeave({ attendanceStatus: undefined })))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.reconcileApprovedLeave(approvedLeave({ attendanceStatus: 'PRESENT' })))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(resolver.resolveWorkContext).not.toHaveBeenCalled();
    expect(repository.createDaily).not.toHaveBeenCalled();
  });

  test('preflights every leave date before writing when a later date conflicts', async () => {
    const request = approvedLeave({
      workingDateSnapshots: [
        { dateKey: '2026-07-18', units: 2, scheduleSnapshot: savedScheduleSnapshot() },
        { dateKey: '2026-07-19', units: 2, scheduleSnapshot: savedScheduleSnapshot() },
      ],
    });
    repository.findByProfileAndWorkDate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: '660000000000000000000017',
        profileId,
        workDateKey: '2026-07-19',
        status: 'PRESENT',
        checkInAt: new Date('2026-07-19T01:00:00.000Z'),
      });

    await expect(service.reconcileApprovedLeave(request, { session: { id: 'session' } }))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    expect(resolver.resolveWorkContext).not.toHaveBeenCalled();
    expect(repository.findByProfileAndWorkDate).toHaveBeenCalledTimes(2);
    expect(repository.createDaily).not.toHaveBeenCalled();
    expect(repository.updateLeaveProjection).not.toHaveBeenCalled();
  });

  test('wraps all multi-day projection writes in one owned transaction', async () => {
    const request = approvedLeave({
      workingDateSnapshots: [
        { dateKey: '2026-07-18', units: 2, scheduleSnapshot: savedScheduleSnapshot() },
        { dateKey: '2026-07-19', units: 2, scheduleSnapshot: savedScheduleSnapshot() },
      ],
    });
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    mongoose.startSession.mockResolvedValue(session);
    repository.findByProfileAndWorkDate.mockResolvedValue(null);
    repository.createDaily
      .mockResolvedValueOnce({ _id: 'first', profileId, workDateKey: '2026-07-18' })
      .mockRejectedValueOnce(new Error('second write failed'));

    await expect(service.reconcileApprovedLeave(request)).rejects.toThrow('second write failed');

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(repository.createDaily).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ workDateKey: '2026-07-18' }),
      { session },
    );
    expect(repository.createDaily).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ workDateKey: '2026-07-19' }),
      { session },
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test('reverses only one leave request and preserves unrelated attendance data', async () => {
    const current = {
      _id: '660000000000000000000035',
      profileId,
      workDateKey: '2026-07-18',
      status: 'HALF_DAY',
      source: 'SELF_SERVICE',
      checkInAt: new Date('2026-07-18T05:00:00.000Z'),
      checkOutAt: null,
      scheduleSnapshot: savedScheduleSnapshot(),
      manualAdjustments: [{ reason: 'Preserve me' }],
      leaveSegments: [
        { requestId: '660000000000000000000030', portion: 'MORNING', units: 1, attendanceStatus: 'PAID_LEAVE' },
        { requestId: '660000000000000000000036', portion: 'AFTERNOON', units: 1, attendanceStatus: 'UNPAID_LEAVE' },
      ],
    };
    repository.findByLeaveRequestId.mockResolvedValue([current]);

    await service.reverseApprovedLeave(profileId, '660000000000000000000030', { session: { id: 'session' } });

    expect(repository.updateLeaveProjection).toHaveBeenCalledWith(
      current._id,
      expect.objectContaining({
        status: 'UNPAID_LEAVE',
        workDayValue: 0,
        calculationReason: 'APPROVED_LEAVE',
        checkInAt: current.checkInAt,
        manualAdjustments: current.manualAdjustments,
        leaveSegments: [expect.objectContaining({ requestId: '660000000000000000000036' })],
      }),
      expect.any(Object),
    );
    expect(repository.removeById).not.toHaveBeenCalled();
  });

  test('removes a pure leave projection when its linked request is reversed', async () => {
    repository.findByLeaveRequestId.mockResolvedValue([{
      _id: '660000000000000000000035',
      profileId,
      workDateKey: '2026-07-18',
      status: 'PAID_LEAVE',
      source: 'LEAVE_RECONCILIATION',
      checkInAt: null,
      checkOutAt: null,
      manualAdjustments: [],
      leaveSegments: [{
        requestId: '660000000000000000000030',
        portion: 'FULL_DAY',
        units: 2,
        attendanceStatus: 'PAID_LEAVE',
      }],
    }]);

    await service.reverseApprovedLeave(profileId, '660000000000000000000030', { session: { id: 'session' } });

    expect(repository.removeById).toHaveBeenCalledWith(
      '660000000000000000000035',
      { session: { id: 'session' } },
    );
  });
});
