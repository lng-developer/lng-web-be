jest.mock('mongoose', () => ({
  startSession: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
  findById: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/leave.repository', () => ({
  consumeBalanceUnits: jest.fn(),
  createRequest: jest.fn(),
  findBalance: jest.fn(),
  findOverlappingRequests: jest.fn(),
  findRequestById: jest.fn(),
  listBalances: jest.fn(),
  listRequests: jest.fn(),
  refundBalanceUnits: jest.fn(),
  transitionRequest: jest.fn(),
  upsertBalance: jest.fn(),
}));
jest.mock('../../../modules/hr/services/scheduleResolver.service', () => ({
  resolveWorkContext: jest.fn(),
}));
jest.mock('../../../modules/hr/services/attendance.service', () => ({
  reconcileApprovedLeave: jest.fn(),
  reverseApprovedLeave: jest.fn(),
}));
jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  getCurrentAccount: jest.fn(),
}));

const mongoose = require('mongoose');
const authPublic = require('../../../modules/auth/public');
const profileRepository = require('../../../modules/hr/repositories/employeeProfile.repository');
const repository = require('../../../modules/hr/repositories/leave.repository');
const attendanceService = require('../../../modules/hr/services/attendance.service');
const resolver = require('../../../modules/hr/services/scheduleResolver.service');
const service = require('../../../modules/hr/services/leave.service');

const profileId = '660000000000000000000001';
const accountId = '660000000000000000000002';
const departmentId = '660000000000000000000003';
const teamId = '660000000000000000000004';
const requestId = '660000000000000000000010';
const profile = {
  _id: profileId,
  accountId,
  employeeCode: 'EMP001',
  fullName: 'Test Employee',
  departmentId,
  teamId,
  status: 'ACTIVE',
  isDeleted: false,
};
const requester = { accountId, permissions: ['HR_LEAVE:WRITE'], scopes: [] };
const approver = {
  accountId: '660000000000000000000020',
  permissions: ['HR_LEAVE:APPROVE'],
  scopes: [],
};

function workContext(workDateKey, overrides = {}) {
  return {
    status: 'WORKING_DAY',
    isWorkingDay: true,
    workDateKey,
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
    year: 2026,
    leaveType: 'ANNUAL',
    attendanceStatus: 'PAID_LEAVE',
    portion: 'FULL_DAY',
    startDateKey: '2026-07-20',
    endDateKey: '2026-07-21',
    requestedUnits: 4,
    workingDateSnapshots: [
      { dateKey: '2026-07-20', units: 2, scheduleSnapshot: { timezone: 'Asia/Ho_Chi_Minh' } },
      { dateKey: '2026-07-21', units: 2, scheduleSnapshot: { timezone: 'Asia/Ho_Chi_Minh' } },
    ],
    requesterSnapshot: {
      accountId,
      profileId,
      employeeCode: 'EMP001',
      fullName: 'Test Employee',
      departmentId,
      teamId,
    },
    reason: 'Family trip',
    status: 'PENDING',
    decision: null,
    cancellation: null,
    createdAt: new Date('2026-07-18T00:00:00.000Z'),
    updatedAt: new Date('2026-07-18T00:00:00.000Z'),
    ...overrides,
  };
}

function mockSession() {
  const session = {
    withTransaction: jest.fn(async (callback) => callback()),
    endSession: jest.fn(),
  };
  mongoose.startSession.mockResolvedValue(session);
  return session;
}

describe('leave service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    profileRepository.findByAccountId.mockResolvedValue(profile);
    profileRepository.findById.mockResolvedValue(profile);
    repository.findOverlappingRequests.mockResolvedValue([]);
    repository.createRequest.mockImplementation(async (payload) => ({ _id: requestId, ...payload }));
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => workContext(workDateKey));
    authPublic.getCurrentAccount.mockResolvedValue({ profile: { fullName: 'HR Approver' } });
    authPublic.canAccessScope.mockReturnValue(false);
    attendanceService.reconcileApprovedLeave.mockResolvedValue([]);
    attendanceService.reverseApprovedLeave.mockResolvedValue([]);
    mockSession();
  });

  test('calculates full-day units from working dates and omits rest days', async () => {
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => (
      workDateKey === '2026-07-21'
        ? workContext(workDateKey, { status: 'REST_DAY', isWorkingDay: false })
        : workContext(workDateKey)
    ));

    const result = await service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'FULL_DAY',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-22',
      reason: 'Family trip',
    }, requester);

    expect(repository.findOverlappingRequests).toHaveBeenCalledWith(
      profileId,
      [
        '2026-07-20:MORNING',
        '2026-07-20:AFTERNOON',
        '2026-07-22:MORNING',
        '2026-07-22:AFTERNOON',
      ],
    );
    expect(repository.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      year: 2026,
      attendanceStatus: 'PAID_LEAVE',
      requestedUnits: 4,
      workingDateKeys: ['2026-07-20', '2026-07-22'],
      conflictKeys: [
        '2026-07-20:MORNING',
        '2026-07-20:AFTERNOON',
        '2026-07-22:MORNING',
        '2026-07-22:AFTERNOON',
      ],
      workingDateSnapshots: [
        expect.objectContaining({ dateKey: '2026-07-20', units: 2 }),
        expect.objectContaining({ dateKey: '2026-07-22', units: 2 }),
      ],
      requesterSnapshot: expect.objectContaining({ departmentId, teamId }),
      status: 'PENDING',
    }));
    expect(result.requestedUnits).toBe(4);
  });

  test('uses one integer unit for a single half day and rejects a spanning half day', async () => {
    await service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'MORNING',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-20',
      reason: 'Appointment',
    }, requester);

    expect(repository.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestedUnits: 1,
      conflictKeys: ['2026-07-20:MORNING'],
      workingDateSnapshots: [expect.objectContaining({ dateKey: '2026-07-20', units: 1 })],
    }));

    await expect(service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'AFTERNOON',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-21',
      reason: 'Invalid range',
    }, requester)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('rejects overlap with a pending or approved request', async () => {
    repository.findOverlappingRequests.mockResolvedValue([{ _id: 'existing' }]);

    await expect(service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'FULL_DAY',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-20',
      reason: 'Overlap',
    }, requester)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    expect(repository.createRequest).not.toHaveBeenCalled();
  });

  test('allows complementary morning and afternoon requests but rejects a concurrent duplicate-key winner', async () => {
    await service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'AFTERNOON',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-20',
      reason: 'Appointment',
    }, requester);

    expect(repository.findOverlappingRequests).toHaveBeenCalledWith(
      profileId,
      ['2026-07-20:AFTERNOON'],
    );
    expect(repository.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      conflictKeys: ['2026-07-20:AFTERNOON'],
    }));

    repository.createRequest.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11000 }));
    await expect(service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'AFTERNOON',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-20',
      reason: 'Concurrent request',
    }, requester)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  });

  test('rejects a request when any date has an unresolved schedule or no working date', async () => {
    resolver.resolveWorkContext.mockResolvedValueOnce({ status: 'SCHEDULE_UNRESOLVED' });
    await expect(service.createRequest({
      leaveType: 'ANNUAL', portion: 'FULL_DAY', startDateKey: '2026-07-20', endDateKey: '2026-07-20', reason: 'No schedule',
    }, requester)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    resolver.resolveWorkContext.mockResolvedValueOnce(workContext('2026-07-20', { status: 'HOLIDAY', isWorkingDay: false }));
    await expect(service.createRequest({
      leaveType: 'ANNUAL', portion: 'FULL_DAY', startDateKey: '2026-07-20', endDateKey: '2026-07-20', reason: 'Holiday',
    }, requester)).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
  });

  test('reconciles saved leave projection before balance and state commit in the same transaction', async () => {
    const request = pendingRequest();
    repository.findRequestById.mockResolvedValue(request);
    repository.consumeBalanceUnits.mockResolvedValue({ modifiedCount: 1 });
    repository.transitionRequest.mockResolvedValue({
      ...request,
      status: 'APPROVED',
      decision: { actorId: approver.accountId, actorName: 'HR Approver' },
    });
    const session = mockSession();

    const result = await service.approveRequest(requestId, approver);

    expect(repository.consumeBalanceUnits).toHaveBeenCalledWith(
      profileId,
      2026,
      'ANNUAL',
      4,
      expect.objectContaining({ actorId: approver.accountId, requestId }),
      { session },
    );
    expect(repository.transitionRequest).toHaveBeenCalledWith(
      requestId,
      'PENDING',
      expect.objectContaining({ status: 'APPROVED' }),
      { session },
    );
    expect(attendanceService.reconcileApprovedLeave).toHaveBeenCalledWith(
      request,
      { session },
    );
    expect(attendanceService.reconcileApprovedLeave.mock.invocationCallOrder[0])
      .toBeLessThan(repository.consumeBalanceUnits.mock.invocationCallOrder[0]);
    expect(result.status).toBe('APPROVED');
  });

  test('does not consume balance or transition when attendance reconciliation fails', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());
    attendanceService.reconcileApprovedLeave.mockRejectedValue(new Error('projection failed'));

    await expect(service.approveRequest(requestId, approver)).rejects.toThrow('projection failed');

    expect(repository.consumeBalanceUnits).not.toHaveBeenCalled();
    expect(repository.transitionRequest).not.toHaveBeenCalled();
  });

  test('lets only one approval consume the final balance', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());
    repository.consumeBalanceUnits.mockResolvedValue({ modifiedCount: 0 });

    await expect(service.approveRequest(requestId, approver))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    expect(repository.transitionRequest).not.toHaveBeenCalled();
    expect(attendanceService.reconcileApprovedLeave).toHaveBeenCalledTimes(1);
  });

  test('denies self approval and evaluates scope against the request snapshot', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());

    await expect(service.approveRequest(requestId, {
      accountId,
      permissions: ['HR_LEAVE:APPROVE'],
      scopes: [],
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });

    const scopedApprover = {
      accountId: approver.accountId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: teamId, permissions: ['HR_LEAVE:APPROVE'] }],
    };
    authPublic.canAccessScope.mockImplementation((_auth, _permission, scope) => (
      scope.scopeType === 'team' && scope.scopeId === teamId
    ));
    repository.consumeBalanceUnits.mockResolvedValue({ modifiedCount: 1 });
    repository.transitionRequest.mockResolvedValue({ ...pendingRequest(), status: 'APPROVED' });

    await service.approveRequest(requestId, scopedApprover);

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(
      scopedApprover,
      'HR_LEAVE:APPROVE',
      { scopeType: 'team', scopeId: teamId },
    );
  });

  test('uses UNPAID_LEAVE explicitly for unpaid leave approval', async () => {
    const request = pendingRequest({ leaveType: 'UNPAID', attendanceStatus: 'UNPAID_LEAVE' });
    repository.findRequestById.mockResolvedValue(request);
    repository.consumeBalanceUnits.mockResolvedValue({ modifiedCount: 1 });
    repository.transitionRequest.mockResolvedValue({ ...request, status: 'APPROVED' });

    await service.approveRequest(requestId, approver);

    expect(attendanceService.reconcileApprovedLeave).toHaveBeenCalledWith(
      request,
      { session: expect.any(Object) },
    );
  });

  test('authorizes before returning an already approved request and repairs its projection on retry', async () => {
    const approvedRequest = pendingRequest({ status: 'APPROVED' });
    repository.findRequestById.mockResolvedValue(approvedRequest);

    await expect(service.approveRequest(requestId, {
      accountId,
      permissions: ['HR_LEAVE:APPROVE'],
      scopes: [],
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
    expect(attendanceService.reconcileApprovedLeave).not.toHaveBeenCalled();

    const session = mockSession();
    await service.approveRequest(requestId, approver);

    expect(attendanceService.reconcileApprovedLeave).toHaveBeenCalledWith(
      approvedRequest,
      { session },
    );
    expect(repository.consumeBalanceUnits).not.toHaveBeenCalled();
  });

  test('re-reads an approved retry in the transaction and never recreates attendance after cancellation', async () => {
    const approvedRequest = pendingRequest({ status: 'APPROVED' });
    const cancelledRequest = pendingRequest({ status: 'CANCELLED' });
    const session = mockSession();
    repository.findRequestById
      .mockResolvedValueOnce(approvedRequest)
      .mockResolvedValueOnce(cancelledRequest);

    await expect(service.approveRequest(requestId, approver))
      .rejects.toMatchObject({ code: 'CONFLICT_ERROR' });

    expect(repository.findRequestById).toHaveBeenLastCalledWith(requestId, { session });
    expect(attendanceService.reconcileApprovedLeave).not.toHaveBeenCalled();
    expect(repository.consumeBalanceUnits).not.toHaveBeenCalled();
    expect(repository.refundBalanceUnits).not.toHaveBeenCalled();
    expect(repository.transitionRequest).not.toHaveBeenCalled();
  });

  test('rejects a pending request with a decision snapshot', async () => {
    const request = pendingRequest();
    repository.findRequestById.mockResolvedValue(request);
    repository.transitionRequest.mockResolvedValue({
      ...request,
      status: 'REJECTED',
      decision: { actorId: approver.accountId, actorName: 'HR Approver', reason: 'Coverage unavailable' },
    });

    const result = await service.rejectRequest(requestId, { reason: 'Coverage unavailable' }, approver);

    expect(repository.transitionRequest).toHaveBeenCalledWith(
      requestId,
      'PENDING',
      expect.objectContaining({
        status: 'REJECTED',
        decision: expect.objectContaining({ actorId: approver.accountId, reason: 'Coverage unavailable' }),
      }),
    );
    expect(result.status).toBe('REJECTED');
  });

  test('authorizes before returning an already rejected request', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest({ status: 'REJECTED' }));

    await expect(service.rejectRequest(requestId, { reason: 'Again' }, requester))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
  });

  test('allows requester to cancel pending leave without touching balance', async () => {
    const request = pendingRequest();
    repository.findRequestById.mockResolvedValue(request);
    repository.transitionRequest.mockResolvedValue({ ...request, status: 'CANCELLED' });

    await service.cancelRequest(requestId, { reason: 'Plans changed' }, requester);

    expect(repository.transitionRequest).toHaveBeenCalledWith(
      requestId,
      'PENDING',
      expect.objectContaining({ status: 'CANCELLED' }),
    );
    expect(repository.refundBalanceUnits).not.toHaveBeenCalled();
  });

  test('returns own pending cancellation capability with a requester summary', async () => {
    repository.listRequests.mockResolvedValue({
      items: [pendingRequest(), pendingRequest({ _id: '660000000000000000000011' })],
      pagination: { page: 1, limit: 20, total: 2 },
    });

    const result = await service.listRequests({ own: true }, requester);

    expect(result.items[0]).toMatchObject({
      employee: { id: profileId, employeeCode: 'EMP001', fullName: 'Test Employee' },
      capabilities: { view: true, approve: false, reject: false, cancel: true },
    });
  });

  test('returns approval capabilities only for a non-self scoped approver and disables terminal actions', async () => {
    const scopedApprover = {
      accountId: approver.accountId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: teamId, permissions: ['HR_LEAVE:APPROVE'] }],
    };
    authPublic.canAccessScope.mockImplementation((_auth, _permission, scope) => (
      scope.scopeType === 'team' && scope.scopeId === teamId
    ));
    repository.listRequests.mockResolvedValue({
      items: [
        pendingRequest({ requesterSnapshot: { ...pendingRequest().requesterSnapshot, accountId } }),
        pendingRequest({ _id: '660000000000000000000012', status: 'REJECTED' }),
      ],
      pagination: { page: 1, limit: 20, total: 2 },
    });

    const result = await service.listRequests({}, scopedApprover);

    expect(result.items[0].capabilities).toEqual({ view: true, approve: true, reject: true, cancel: false });
    expect(result.items[1].capabilities).toEqual({ view: true, approve: false, reject: false, cancel: false });
  });

  test('authorizes before returning an already cancelled request', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest({ status: 'CANCELLED' }));

    await expect(service.cancelRequest(requestId, { reason: 'Again' }, {
      accountId: '660000000000000000000099',
      permissions: [],
      scopes: [],
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
  });

  test('cancels approved future leave and refunds exactly the consumed units in one transaction', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
    const request = pendingRequest({ status: 'APPROVED' });
    repository.findRequestById.mockResolvedValue(request);
    repository.refundBalanceUnits.mockResolvedValue({ modifiedCount: 1 });
    repository.transitionRequest.mockResolvedValue({ ...request, status: 'CANCELLED' });
    authPublic.canAccessScope.mockReturnValue(true);
    const session = mockSession();

    await service.cancelRequest(requestId, { reason: 'Approved cancellation' }, approver);

    expect(repository.refundBalanceUnits).toHaveBeenCalledWith(
      profileId,
      2026,
      'ANNUAL',
      4,
      expect.objectContaining({ actorId: approver.accountId, requestId }),
      { session },
    );
    expect(repository.transitionRequest).toHaveBeenCalledWith(
      requestId,
      'APPROVED',
      expect.objectContaining({ status: 'CANCELLED' }),
      { session },
    );
    expect(attendanceService.reverseApprovedLeave).toHaveBeenCalledWith(
      profileId,
      requestId,
      { session },
    );
    expect(attendanceService.reverseApprovedLeave.mock.invocationCallOrder[0])
      .toBeLessThan(repository.refundBalanceUnits.mock.invocationCallOrder[0]);
    jest.useRealTimers();
  });
});
