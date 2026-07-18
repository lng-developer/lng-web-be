jest.mock('../../../modules/hr/repositories/overtime.repository', () => ({
  createRequest: jest.fn(),
  findOverlappingRequests: jest.fn(),
  findRequestById: jest.fn(),
  listRequests: jest.fn(),
  transitionRequest: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
}));
jest.mock('../../../modules/hr/services/scheduleResolver.service', () => ({
  resolveWorkContext: jest.fn(),
}));
jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  getCurrentAccount: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const profileRepository = require('../../../modules/hr/repositories/employeeProfile.repository');
const repository = require('../../../modules/hr/repositories/overtime.repository');
const scheduleResolver = require('../../../modules/hr/services/scheduleResolver.service');
const service = require('../../../modules/hr/services/overtime.service');

const accountId = '660000000000000000000001';
const profileId = '660000000000000000000002';
const teamId = '660000000000000000000003';
const departmentId = '660000000000000000000004';
const requestId = '660000000000000000000005';
const approverId = '660000000000000000000006';

const requester = {
  accountId,
  permissions: ['HR_OVERTIME:WRITE'],
  scopes: [],
};
const approver = {
  accountId: approverId,
  permissions: ['HR_OVERTIME:APPROVE'],
  scopes: [],
};

function context(overrides = {}) {
  return {
    status: 'WORKING_DAY',
    isWorkingDay: true,
    assignment: { id: '660000000000000000000010' },
    workLocation: {
      id: '660000000000000000000011',
      code: 'HCM',
      name: 'HCM Office',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    shift: {
      id: '660000000000000000000012',
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

function pendingRequest(overrides = {}) {
  return {
    _id: requestId,
    profileId,
    accountId,
    workDateKey: '2026-07-20',
    plannedStartTime: '18:00',
    plannedEndTime: '20:00',
    startMinute: 1080,
    endMinute: 1200,
    requestedMinutes: 120,
    approvedMinutes: null,
    calendarClass: 'WORKDAY',
    requesterSnapshot: {
      accountId,
      profileId,
      employeeCode: 'EMP001',
      fullName: 'Test Employee',
      departmentId,
      teamId,
    },
    scheduleSnapshot: {
      timezone: 'Asia/Ho_Chi_Minh',
      departmentId,
      teamId,
      shift: { startTime: '08:00', endTime: '17:00' },
    },
    reason: 'Month-end support',
    status: 'PENDING',
    decision: null,
    cancellation: null,
    ...overrides,
  };
}

describe('overtime service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    profileRepository.findByAccountId.mockImplementation(async (id) => ({
      _id: id === accountId ? profileId : '660000000000000000000099',
      accountId: id,
      employeeCode: id === accountId ? 'EMP001' : 'HR001',
      fullName: id === accountId ? 'Test Employee' : 'HR Approver',
      departmentId,
      teamId,
      status: 'ACTIVE',
      isDeleted: false,
    }));
    scheduleResolver.resolveWorkContext.mockResolvedValue(context());
    repository.findOverlappingRequests.mockResolvedValue([]);
    repository.createRequest.mockImplementation(async (payload) => ({ _id: requestId, ...payload }));
    authPublic.canAccessScope.mockReturnValue(false);
    authPublic.getCurrentAccount.mockResolvedValue(null);
  });

  test('creates a snapshotted request and derives integer minutes and calendar class', async () => {
    const result = await service.createRequest({
      workDateKey: '2026-07-20',
      plannedStartTime: '18:00',
      plannedEndTime: '20:00',
      reason: 'Month-end support',
    }, requester);

    const startEpochMinute = Date.parse('2026-07-20T11:00:00.000Z') / 60000;
    expect(repository.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      profileId,
      workDateKey: '2026-07-20',
      startMinute: 1080,
      endMinute: 1200,
      plannedStartAt: new Date('2026-07-20T11:00:00.000Z'),
      plannedEndAt: new Date('2026-07-20T13:00:00.000Z'),
      requestedMinutes: 120,
      calendarClass: 'WORKDAY',
      requesterSnapshot: expect.objectContaining({ teamId, departmentId }),
      scheduleSnapshot: expect.objectContaining({ timezone: 'Asia/Ho_Chi_Minh' }),
      conflictMinuteKeys: expect.arrayContaining([startEpochMinute, startEpochMinute + 119]),
      status: 'PENDING',
    }));
    expect(result).toMatchObject({ requestedMinutes: 120, calendarClass: 'WORKDAY' });
  });

  test('derives REST_DAY and HOLIDAY from the schedule snapshot', async () => {
    scheduleResolver.resolveWorkContext.mockResolvedValueOnce(context({ status: 'REST_DAY', isWorkingDay: false }));
    await service.createRequest({
      workDateKey: '2026-07-20', plannedStartTime: '08:00', plannedEndTime: '09:00', reason: 'Rest day support',
    }, requester);
    expect(repository.createRequest).toHaveBeenLastCalledWith(expect.objectContaining({ calendarClass: 'REST_DAY' }));

    scheduleResolver.resolveWorkContext.mockResolvedValueOnce(context({ status: 'HOLIDAY', isWorkingDay: false }));
    await service.createRequest({
      workDateKey: '2026-07-20', plannedStartTime: '08:00', plannedEndTime: '09:00', reason: 'Holiday support',
    }, requester);
    expect(repository.createRequest).toHaveBeenLastCalledWith(expect.objectContaining({ calendarClass: 'HOLIDAY' }));
  });

  test('rejects unresolved schedules and durations outside 30 through 960 minutes', async () => {
    scheduleResolver.resolveWorkContext.mockResolvedValueOnce({ status: 'SCHEDULE_UNRESOLVED' });
    await expect(service.createRequest({
      workDateKey: '2026-07-20', plannedStartTime: '18:00', plannedEndTime: '20:00', reason: 'No schedule',
    }, requester)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    await expect(service.createRequest({
      workDateKey: '2026-07-20', plannedStartTime: '18:00', plannedEndTime: '18:29', reason: 'Too short',
    }, requester)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.createRequest({
      workDateKey: '2026-07-20', plannedStartTime: '08:00', plannedEndTime: '00:01', reason: 'Too long',
    }, requester)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('rejects normal shift overlap unless attendance management scope permits it', async () => {
    const payload = {
      workDateKey: '2026-07-20', plannedStartTime: '16:30', plannedEndTime: '18:00', reason: 'Shift overlap',
    };
    await expect(service.createRequest(payload, requester))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
    expect(repository.createRequest).not.toHaveBeenCalled();

    const manager = {
      accountId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: teamId, permissions: ['HR_ATTENDANCE:MANAGE'] }],
    };
    authPublic.canAccessScope.mockImplementation((_auth, permission, scope) => (
      permission === 'HR_ATTENDANCE:MANAGE' && scope.scopeType === 'team' && scope.scopeId === teamId
    ));
    await service.createRequest(payload, manager);
    expect(repository.createRequest).toHaveBeenCalledTimes(1);
  });

  test('rejects existing overlap and maps a concurrent unique-key winner to conflict', async () => {
    repository.findOverlappingRequests.mockResolvedValueOnce([{ _id: 'existing' }]);
    await expect(service.createRequest({
      workDateKey: '2026-07-20', plannedStartTime: '18:00', plannedEndTime: '20:00', reason: 'Overlap',
    }, requester)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    repository.findOverlappingRequests.mockResolvedValueOnce([]);
    repository.createRequest.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11000 }));
    await expect(service.createRequest({
      workDateKey: '2026-07-20', plannedStartTime: '18:00', plannedEndTime: '20:00', reason: 'Race',
    }, requester)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  });

  test('rejects adjacent-work-date requests whose absolute overnight ranges overlap', async () => {
    await service.createRequest({
      workDateKey: '2026-07-20',
      plannedStartTime: '23:30',
      plannedEndTime: '01:30',
      reason: 'Overnight deployment',
    }, requester);
    const first = repository.createRequest.mock.calls[0][0];
    repository.findOverlappingRequests.mockImplementation(async (_profile, startAt, endAt) => (
      first.plannedStartAt < endAt && first.plannedEndAt > startAt ? [first] : []
    ));

    await expect(service.createRequest({
      workDateKey: '2026-07-21',
      plannedStartTime: '01:00',
      plannedEndTime: '02:00',
      reason: 'Overlapping support',
    }, requester)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    expect(repository.findOverlappingRequests).toHaveBeenLastCalledWith(
      profileId,
      new Date('2026-07-20T18:00:00.000Z'),
      new Date('2026-07-20T19:00:00.000Z'),
    );
  });

  test('allows adjacent-work-date requests when their absolute ranges only touch', async () => {
    await service.createRequest({
      workDateKey: '2026-07-20',
      plannedStartTime: '23:00',
      plannedEndTime: '00:30',
      reason: 'Overnight deployment',
    }, requester);
    const first = repository.createRequest.mock.calls[0][0];
    repository.findOverlappingRequests.mockImplementation(async (_profile, startAt, endAt) => (
      first.plannedStartAt < endAt && first.plannedEndAt > startAt ? [first] : []
    ));

    await expect(service.createRequest({
      workDateKey: '2026-07-21',
      plannedStartTime: '00:30',
      plannedEndTime: '01:30',
      reason: 'Next shift support',
    }, requester)).resolves.toMatchObject({ status: 'PENDING' });

    expect(repository.createRequest).toHaveBeenCalledTimes(2);
  });

  test('rejects overtime overlapping a prior overnight shift or the next work-date shift', async () => {
    scheduleResolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => {
      if (workDateKey === '2026-07-19') {
        return context({
          workDateKey,
          shift: {
            ...context().shift,
            startTime: '22:00',
            endTime: '06:00',
            durationMinutes: 480,
            isOvernight: true,
          },
        });
      }
      return context({ workDateKey });
    });

    await expect(service.createRequest({
      workDateKey: '2026-07-20',
      plannedStartTime: '01:00',
      plannedEndTime: '03:00',
      reason: 'Prior shift overlap',
    }, requester)).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });

    jest.clearAllMocks();
    profileRepository.findByAccountId.mockResolvedValue({
      _id: profileId,
      accountId,
      employeeCode: 'EMP001',
      fullName: 'Test Employee',
      departmentId,
      teamId,
      status: 'ACTIVE',
      isDeleted: false,
    });
    repository.findOverlappingRequests.mockResolvedValue([]);
    authPublic.canAccessScope.mockReturnValue(false);
    scheduleResolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => context({ workDateKey }));

    await expect(service.createRequest({
      workDateKey: '2026-07-20',
      plannedStartTime: '23:00',
      plannedEndTime: '09:00',
      reason: 'Next shift overlap',
    }, requester)).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });

    expect(repository.createRequest).not.toHaveBeenCalled();
  });

  test('allows partial approval in positive integer minutes and transitions once', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());
    repository.transitionRequest.mockResolvedValue(pendingRequest({
      status: 'APPROVED', approvedMinutes: 90, decision: { actorId: approverId, actorName: 'HR Approver' },
    }));

    const result = await service.approveRequest(requestId, { approvedMinutes: 90 }, approver);

    expect(repository.transitionRequest).toHaveBeenCalledWith(
      requestId,
      'PENDING',
      expect.objectContaining({
        status: 'APPROVED',
        approvedMinutes: 90,
        decision: expect.objectContaining({ actorId: approverId }),
      }),
    );
    expect(result).toMatchObject({ approvedMinutes: 90, status: 'APPROVED' });
  });

  test('forbids self approval and evaluates approval against snapshotted scope', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());
    await expect(service.approveRequest(requestId, {}, requester))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });

    const scopedApprover = {
      accountId: approverId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: teamId, permissions: ['HR_OVERTIME:APPROVE'] }],
    };
    authPublic.canAccessScope.mockImplementation((_auth, permission, scope) => (
      permission === 'HR_OVERTIME:APPROVE' && scope.scopeType === 'team' && scope.scopeId === teamId
    ));
    repository.transitionRequest.mockResolvedValue(pendingRequest({ status: 'APPROVED', approvedMinutes: 120 }));

    await service.approveRequest(requestId, {}, scopedApprover);

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(
      scopedApprover,
      'HR_OVERTIME:APPROVE',
      { scopeType: 'team', scopeId: teamId },
    );
  });

  test('authorizes before terminal idempotency and rejects a different repeated approval', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest({ status: 'APPROVED', approvedMinutes: 90 }));
    await expect(service.approveRequest(requestId, { approvedMinutes: 90 }, requester))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
    await expect(service.approveRequest(requestId, { approvedMinutes: 60 }, approver))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
    await expect(service.approveRequest(requestId, { approvedMinutes: 90 }, approver))
      .resolves.toMatchObject({ status: 'APPROVED', approvedMinutes: 90 });
    expect(repository.transitionRequest).not.toHaveBeenCalled();
  });

  test('rejects invalid approval minutes and concurrent transition losers', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());
    await expect(service.approveRequest(requestId, { approvedMinutes: 0 }, approver))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.approveRequest(requestId, { approvedMinutes: 121 }, approver))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.approveRequest(requestId, { approvedMinutes: 1.5 }, approver))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    repository.transitionRequest.mockResolvedValue(null);
    await expect(service.approveRequest(requestId, { approvedMinutes: 90 }, approver))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  });

  test('scoped approver rejects once and requester cancels pending once', async () => {
    const scopedApprover = {
      accountId: approverId,
      permissions: [],
      scopes: [{ scopeType: 'department', scopeId: departmentId, permissions: ['HR_OVERTIME:APPROVE'] }],
    };
    authPublic.canAccessScope.mockImplementation((_auth, permission, scope) => (
      permission === 'HR_OVERTIME:APPROVE'
      && scope.scopeType === 'department'
      && scope.scopeId === departmentId
    ));
    repository.findRequestById.mockResolvedValueOnce(pendingRequest());
    repository.transitionRequest.mockResolvedValueOnce(pendingRequest({ status: 'REJECTED' }));
    await expect(service.rejectRequest(requestId, { reason: 'No coverage' }, scopedApprover))
      .resolves.toMatchObject({ status: 'REJECTED' });

    repository.findRequestById.mockResolvedValueOnce(pendingRequest());
    repository.transitionRequest.mockResolvedValueOnce(pendingRequest({ status: 'CANCELLED' }));
    await expect(service.cancelRequest(requestId, { reason: 'Plans changed' }, requester))
      .resolves.toMatchObject({ status: 'CANCELLED' });
  });

  test('authorizes before reject/cancel idempotency and denies cancellation by another user', async () => {
    repository.findRequestById.mockResolvedValueOnce(pendingRequest({ status: 'REJECTED' }));
    await expect(service.rejectRequest(requestId, { reason: 'Again' }, requester))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });

    repository.findRequestById.mockResolvedValueOnce(pendingRequest({ status: 'CANCELLED' }));
    await expect(service.cancelRequest(requestId, { reason: 'Again' }, { ...requester, accountId: approverId }))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
  });
});
