jest.mock('../../../modules/hr/repositories/overtime.repository', () => ({
  createRequest: jest.fn(),
  findOverlappingRequests: jest.fn(),
  findRequestById: jest.fn(),
  listRequests: jest.fn(),
  transitionRequest: jest.fn(),
  updatePendingRequest: jest.fn(),
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
jest.mock('../../../modules/audit/public', () => ({ record: jest.fn().mockResolvedValue({ id: 'audit-1' }) }));
jest.mock('../../../modules/notification/public', () => ({ notify: jest.fn().mockResolvedValue({ delivered: true, id: 'notification-1' }) }));
jest.mock('../../../modules/organization/public', () => ({
  listDepartmentsByIds: jest.fn(),
  listTeamsByIds: jest.fn(),
  listAccountOrganizationSummaries: jest.fn(),
  listTeamMembers: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const auditPublic = require('../../../modules/audit/public');
const notificationPublic = require('../../../modules/notification/public');
const organizationPublic = require('../../../modules/organization/public');
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
    plannedStartAt: new Date('2026-07-20T11:00:00.000Z'),
    plannedEndAt: new Date('2026-07-20T13:00:00.000Z'),
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
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId,
      department: { id: '660000000000000000000091', code: 'SALES', name: 'Sales' },
      team: { id: '660000000000000000000092', code: 'SALES-A', name: 'Sales A' },
    }]);
    organizationPublic.listDepartmentsByIds.mockResolvedValue([
      { id: departmentId, code: 'OPS', name: 'Operations' },
    ]);
    organizationPublic.listTeamsByIds.mockResolvedValue([
      { id: teamId, code: 'OPS-A', name: 'Operations A' },
    ]);
    organizationPublic.listTeamMembers.mockResolvedValue({ leaders: [] });
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
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: accountId,
      action: 'HR_OVERTIME_REQUEST_CREATED',
      entityType: 'HR_OVERTIME_REQUEST',
      entityId: requestId,
      metadata: expect.not.objectContaining({ reason: expect.anything() }),
    }), {});
  });

  test('updates only the requester own pending overtime request', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());
    repository.updatePendingRequest.mockImplementation(async (_id, _accountId, patch) => ({ ...pendingRequest(), ...patch }));

    const result = await service.updateRequest(requestId, {
      workDateKey: '2026-07-21',
      plannedStartTime: '18:30',
      plannedEndTime: '20:30',
      reason: 'Revised support window',
    }, requester);

    expect(repository.findOverlappingRequests).toHaveBeenCalledWith(
      profileId,
      expect.any(Date),
      expect.any(Date),
      { excludeRequestId: requestId },
    );
    expect(repository.updatePendingRequest).toHaveBeenCalledWith(requestId, accountId, expect.objectContaining({
      workDateKey: '2026-07-21',
      plannedStartTime: '18:30',
      reason: 'Revised support window',
    }));
    expect(result).toMatchObject({ workDateKey: '2026-07-21', plannedStartTime: '18:30' });
  });

  test('requires a manager reason when cancelling approved overtime', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest({ status: 'APPROVED' }));
    await expect(service.cancelRequest(requestId, {}, approver))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('records a created overtime mutation before a notification failure is returned', async () => {
    organizationPublic.listTeamMembers.mockResolvedValue({
      leaders: [{ accountId: approverId }],
    });
    notificationPublic.notify.mockRejectedValueOnce(new Error('notification unavailable'));

    await expect(service.createRequest({
      workDateKey: '2026-07-20',
      plannedStartTime: '18:00',
      plannedEndTime: '20:00',
      reason: 'Month-end support',
    }, requester)).rejects.toThrow('notification unavailable');

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_OVERTIME_REQUEST_CREATED',
      entityId: requestId,
    }), {});
    expect(auditPublic.record.mock.invocationCallOrder[0])
      .toBeLessThan(notificationPublic.notify.mock.invocationCallOrder[0]);
  });

  test('continues to overtime notification after a best-effort audit failure', async () => {
    organizationPublic.listTeamMembers.mockResolvedValue({
      leaders: [{ accountId: approverId }],
    });
    auditPublic.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.createRequest({
      workDateKey: '2026-07-20',
      plannedStartTime: '18:00',
      plannedEndTime: '20:00',
      reason: 'Month-end support',
    }, requester)).resolves.toMatchObject({ status: 'PENDING' });

    expect(auditPublic.record.mock.invocationCallOrder[0])
      .toBeLessThan(notificationPublic.notify.mock.invocationCallOrder[0]);
  });

  test('audits each intermediate overtime approval with its persisted level', async () => {
    const scopedApprover = {
      accountId: approverId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: teamId, permissions: ['HR_OVERTIME:APPROVE'] }],
    };
    const request = pendingRequest({
      approvalChain: [
        { level: 1, approverAccountId: approverId, status: 'PENDING' },
        { level: 2, approverAccountId: '660000000000000000000007', status: 'PENDING' },
      ],
      currentApprovalLevel: 1,
    });
    const updated = pendingRequest({
      approvalChain: [
        {
          level: 1, approverAccountId: approverId, status: 'APPROVED',
          actedByAccountId: approverId, actedAt: new Date('2026-07-29T07:00:00.000Z'),
        },
        { level: 2, approverAccountId: '660000000000000000000007', status: 'PENDING' },
      ],
      currentApprovalLevel: 2,
      approvedMinutes: 120,
      updatedAt: new Date('2026-07-29T07:00:00.000Z'),
    });
    authPublic.canAccessScope.mockReturnValue(true);
    repository.findRequestById.mockResolvedValue(request);
    repository.transitionRequest.mockResolvedValue(updated);

    await service.approveRequest(requestId, {}, scopedApprover);

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_OVERTIME_APPROVAL_STEP_APPROVED',
      metadata: { profileId, approvedMinutes: 120, approvalLevel: 1 },
      deduplicationKey: expect.stringContaining(':level:1'),
    }), {});
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

  test('rejects invalid approval minutes', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());
    await expect(service.approveRequest(requestId, { approvedMinutes: 0 }, approver))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.approveRequest(requestId, { approvedMinutes: 121 }, approver))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.approveRequest(requestId, { approvedMinutes: 1.5 }, approver))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

  });

  test('returns the persisted approval when an identical approval loses the transition race', async () => {
    repository.findRequestById
      .mockResolvedValueOnce(pendingRequest())
      .mockResolvedValueOnce(pendingRequest({ status: 'APPROVED', approvedMinutes: 90 }));
    repository.transitionRequest.mockResolvedValue(null);

    await expect(service.approveRequest(requestId, { approvedMinutes: 90 }, approver))
      .resolves.toMatchObject({ status: 'APPROVED', approvedMinutes: 90 });
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

  test('records a rejected overtime mutation before a notification failure is returned', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());
    repository.transitionRequest.mockResolvedValue(pendingRequest({ status: 'REJECTED' }));
    notificationPublic.notify.mockRejectedValueOnce(new Error('notification unavailable'));

    await expect(service.rejectRequest(requestId, { reason: 'No coverage' }, approver))
      .rejects.toThrow('notification unavailable');

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REJECTED',
      entityId: requestId,
    }), {});
    expect(auditPublic.record.mock.invocationCallOrder[0])
      .toBeLessThan(notificationPublic.notify.mock.invocationCallOrder[0]);
  });

  test('returns persisted terminal results when identical reject and cancel transitions lose races', async () => {
    repository.findRequestById
      .mockResolvedValueOnce(pendingRequest())
      .mockResolvedValueOnce(pendingRequest({ status: 'REJECTED' }));
    repository.transitionRequest.mockResolvedValueOnce(null);
    await expect(service.rejectRequest(requestId, { reason: 'No coverage' }, approver))
      .resolves.toMatchObject({ status: 'REJECTED' });

    repository.findRequestById
      .mockResolvedValueOnce(pendingRequest())
      .mockResolvedValueOnce(pendingRequest({ status: 'CANCELLED' }));
    repository.transitionRequest.mockResolvedValueOnce(null);
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

  test('resolves a transferred requester organization from immutable snapshot IDs', async () => {
    const scopedApprover = {
      accountId: approverId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: teamId, permissions: ['HR_OVERTIME:APPROVE'] }],
    };
    authPublic.canAccessScope.mockImplementation((_auth, permission, scope) => (
      permission === 'HR_OVERTIME:APPROVE' && scope.scopeType === 'team' && scope.scopeId === teamId
    ));
    repository.listRequests.mockResolvedValue({
      items: [pendingRequest(), pendingRequest({ _id: '660000000000000000000007', status: 'APPROVED' })],
      pagination: { page: 1, limit: 20, total: 2 },
    });

    const result = await service.listRequests({}, scopedApprover);

    expect(result.items[0]).toMatchObject({
      employee: { id: profileId, employeeCode: 'EMP001', fullName: 'Test Employee' },
      requester: {
        department: { id: departmentId, code: 'OPS', name: 'Operations' },
        team: { id: teamId, code: 'OPS-A', name: 'Operations A' },
      },
      capabilities: { view: true, edit: false, approve: true, reject: true, cancel: false },
    });
    expect(organizationPublic.listDepartmentsByIds).toHaveBeenCalledWith([departmentId]);
    expect(organizationPublic.listTeamsByIds).toHaveBeenCalledWith([teamId]);
    expect(organizationPublic.listAccountOrganizationSummaries).not.toHaveBeenCalled();
    expect(result.items[1].capabilities).toEqual({ view: true, edit: false, approve: false, reject: false, cancel: false });
  });

  test('returns summary counts from the full filtered result set', async () => {
    const summary = {
      total: 3,
      statusCounts: { PENDING: 2, APPROVED: 1, REJECTED: 0, CANCELLED: 0 },
    };
    repository.listRequests.mockResolvedValue({
      items: [pendingRequest()],
      pagination: { page: 1, limit: 1, total: 3 },
      summary,
    });

    const result = await service.listRequests({ page: 1, limit: 1 }, approver);

    expect(result.summary).toEqual(summary);
  });
});
