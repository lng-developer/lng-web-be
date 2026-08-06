jest.mock('mongoose', () => ({
  startSession: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
  findById: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/leave.repository', () => ({
  accrueBalance: jest.fn(),
  adjustBalance: jest.fn(),
  appendAttachments: jest.fn(),
  consumeBalanceUnits: jest.fn(),
  createRequest: jest.fn(),
  findBalance: jest.fn(),
  findOverlappingRequests: jest.fn(),
  findRequestById: jest.fn(),
  ensureBalance: jest.fn(),
  listBalances: jest.fn(),
  listRequests: jest.fn(),
  refundBalanceUnits: jest.fn(),
  resetBalance: jest.fn(),
  setCarryOver: jest.fn(),
  transitionRequest: jest.fn(),
  updatePendingRequest: jest.fn(),
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
jest.mock('../../../modules/audit/public', () => ({ record: jest.fn().mockResolvedValue({ id: 'audit-1' }) }));
jest.mock('../../../modules/notification/public', () => ({ notify: jest.fn().mockResolvedValue({ delivered: true, id: 'notification-1' }) }));
jest.mock('../../../modules/organization/public', () => ({
  listDepartmentsByIds: jest.fn(),
  listTeamsByIds: jest.fn(),
  listAccountOrganizationSummaries: jest.fn(),
  listTeamMembers: jest.fn(),
}));

const mongoose = require('mongoose');
const authPublic = require('../../../modules/auth/public');
const auditPublic = require('../../../modules/audit/public');
const notificationPublic = require('../../../modules/notification/public');
const organizationPublic = require('../../../modules/organization/public');
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
    authPublic.getCurrentAccount.mockResolvedValue({ account: { email: 'hr.approver@lng.co' } });
    authPublic.canAccessScope.mockReturnValue(false);
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

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: accountId,
      action: 'HR_LEAVE_REQUEST_CREATED',
      entityType: 'HR_LEAVE_REQUEST',
      entityId: requestId,
      metadata: expect.not.objectContaining({ reason: expect.anything() }),
    }), {});

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

  test.each([
    ['2026-07-19', '2026-07-20', null],
    ['2026-07-23', '2026-07-01', '2026-07-22'],
  ])('rejects leave on %s outside the employment period', async (dateKey, startDate, endDate) => {
    profileRepository.findByAccountId.mockResolvedValue({
      ...profile,
      startDate: new Date(`${startDate}T00:00:00.000Z`),
      endDate: endDate ? new Date(`${endDate}T00:00:00.000Z`) : null,
    });

    await expect(service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'FULL_DAY',
      startDateKey: dateKey,
      endDateKey: dateKey,
      reason: 'Outside employment period',
    }, requester)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(resolver.resolveWorkContext).not.toHaveBeenCalled();
  });

  test('allows employment boundary dates and an open-ended employment period', async () => {
    profileRepository.findByAccountId.mockResolvedValue({
      ...profile,
      startDate: new Date('2026-07-20T00:00:00.000Z'),
      endDate: null,
    });

    await expect(service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'FULL_DAY',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-20',
      reason: 'Employment boundary',
    }, requester)).resolves.toMatchObject({ startDateKey: '2026-07-20' });
  });

  test('updates only the requester own pending leave request', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest());
    repository.updatePendingRequest.mockImplementation(async (_id, _accountId, patch) => ({ ...pendingRequest(), ...patch }));

    const result = await service.updateRequest(requestId, {
      leaveType: 'SICK',
      portion: 'FULL_DAY',
      startDateKey: '2026-07-22',
      endDateKey: '2026-07-22',
      reason: 'Medical appointment',
    }, requester);

    expect(repository.findOverlappingRequests).toHaveBeenCalledWith(
      profileId,
      ['2026-07-22:MORNING', '2026-07-22:AFTERNOON'],
      { excludeRequestId: requestId },
    );
    expect(repository.updatePendingRequest).toHaveBeenCalledWith(requestId, accountId, expect.objectContaining({
      leaveType: 'SICK',
      startDateKey: '2026-07-22',
      reason: 'Medical appointment',
    }));
    expect(result).toMatchObject({ leaveType: 'SICK', startDateKey: '2026-07-22' });
  });

  test('requires a manager reason when cancelling approved leave', async () => {
    repository.findRequestById.mockResolvedValue(pendingRequest({ status: 'APPROVED' }));
    await expect(service.cancelRequest(requestId, {}, approver))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('records a created leave mutation before a notification failure is returned', async () => {
    organizationPublic.listTeamMembers.mockResolvedValue({
      leaders: [{ accountId: approver.accountId }],
    });
    notificationPublic.notify.mockRejectedValueOnce(new Error('notification unavailable'));

    await expect(service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'FULL_DAY',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-20',
      reason: 'Family trip',
    }, requester)).rejects.toThrow('notification unavailable');

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_LEAVE_REQUEST_CREATED',
      entityId: requestId,
    }), {});
    expect(auditPublic.record.mock.invocationCallOrder[0])
      .toBeLessThan(notificationPublic.notify.mock.invocationCallOrder[0]);
  });

  test('continues to leave notification after a best-effort audit failure', async () => {
    organizationPublic.listTeamMembers.mockResolvedValue({
      leaders: [{ accountId: approver.accountId }],
    });
    auditPublic.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.createRequest({
      leaveType: 'ANNUAL',
      portion: 'FULL_DAY',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-20',
      reason: 'Family trip',
    }, requester)).resolves.toMatchObject({ status: 'PENDING' });

    expect(auditPublic.record.mock.invocationCallOrder[0])
      .toBeLessThan(notificationPublic.notify.mock.invocationCallOrder[0]);
  });

  test('audits attachment references by count without attachment data', async () => {
    const request = pendingRequest({ attachments: [] });
    repository.findRequestById.mockResolvedValue(request);
    repository.appendAttachments.mockResolvedValue({
      ...request,
      attachments: [{ mediaId: 'media-private', filename: 'medical-note.pdf', mimeType: 'application/pdf' }],
      updatedAt: new Date('2026-07-29T04:00:00.000Z'),
    });

    await service.attachReferences(requestId, {
      attachments: [{ mediaId: 'media-private', filename: 'medical-note.pdf', mimeType: 'application/pdf' }],
    }, requester);

    expect(repository.appendAttachments).toHaveBeenCalledWith(requestId, accountId, [
      { mediaId: 'media-private', filename: 'medical-note.pdf', mimeType: 'application/pdf' },
    ], { session: expect.any(Object) });
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_LEAVE_ATTACHMENTS_ADDED',
      metadata: { profileId, attachmentCount: 1 },
    }), { session: expect.any(Object) });
    expect(JSON.stringify(auditPublic.record.mock.calls)).not.toMatch(/media-private|medical-note\.pdf|application\/pdf/);
  });

  test('ignores attachment metadata changes when the mediaId already exists', async () => {
    const request = pendingRequest({
      attachments: [{ mediaId: 'media-existing', filename: 'original.pdf', mimeType: 'application/pdf' }],
    });
    repository.findRequestById.mockResolvedValue(request);
    repository.appendAttachments.mockResolvedValue({
      ...request,
      attachments: [
        ...request.attachments,
        { mediaId: 'media-existing', filename: 'renamed.png', mimeType: 'image/png' },
      ],
    });

    const result = await service.attachReferences(requestId, {
      attachments: [{ mediaId: 'media-existing', filename: 'renamed.png', mimeType: 'image/png' }],
    }, requester);

    expect(repository.appendAttachments).not.toHaveBeenCalled();
    expect(result.attachments).toEqual([
      { mediaId: 'media-existing', filename: 'original.pdf', mimeType: 'application/pdf' },
    ]);
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('audits every leave balance administration family without reasons', async () => {
    const updatedAt = new Date('2026-07-29T05:00:00.000Z');
    const balance = {
      _id: '660000000000000000000030',
      profileId,
      year: 2026,
      leaveType: 'ANNUAL',
      entitledUnits: 24,
      carriedOverUnits: 0,
      adjustmentUnits: 0,
      usedUnits: 0,
      updatedAt,
    };
    repository.upsertBalance.mockResolvedValue(balance);
    repository.adjustBalance.mockResolvedValue(balance);
    repository.ensureBalance.mockResolvedValue(balance);
    repository.accrueBalance.mockResolvedValue(balance);
    repository.resetBalance.mockResolvedValue(balance);
    repository.findBalance
      .mockResolvedValueOnce({ ...balance, entitledUnits: 20 })
      .mockResolvedValueOnce({ ...balance, carriedOverUnits: 0 });
    repository.setCarryOver.mockResolvedValue({ ...balance, carriedOverUnits: 4 });

    await service.upsertBalance(profileId, 2026, 'ANNUAL', {
      entitledUnits: 24, adjustmentUnits: 0, reason: 'Private HR reason',
    }, approver);
    await service.adjustBalance(profileId, 2026, 'ANNUAL', {
      units: 2, reason: 'Private HR reason',
    }, approver);
    await service.accrueBalances({
      profileIds: [profileId], year: 2026, month: 7, units: 2, reason: 'Private HR reason',
    }, approver);
    await service.resetBalances({
      profileIds: [profileId], year: 2026, leaveType: 'ANNUAL', entitledUnits: 24,
      reason: 'Private HR reason',
    }, approver);
    await service.carryOverBalances({
      profileIds: [profileId], fromYear: 2025, toYear: 2026, leaveType: 'ANNUAL',
      maxUnits: 4, reason: 'Private HR reason',
    }, approver);

    expect(auditPublic.record.mock.calls.map(([event]) => event.action)).toEqual([
      'HR_LEAVE_BALANCE_SET',
      'HR_LEAVE_BALANCE_ADJUSTED',
      'HR_LEAVE_BALANCE_ACCRUED',
      'HR_LEAVE_BALANCE_RESET',
      'HR_LEAVE_BALANCE_CARRIED_OVER',
    ]);
    expect(JSON.stringify(auditPublic.record.mock.calls)).not.toContain('Private HR reason');
  });

  test('writes an intermediate leave approval audit in the mutation transaction', async () => {
    const session = mockSession();
    const scopedApprover = {
      accountId: approver.accountId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: teamId, permissions: ['HR_LEAVE:APPROVE'] }],
    };
    const current = pendingRequest({
      approvalChain: [
        { level: 1, approverAccountId: approver.accountId, status: 'PENDING' },
        { level: 2, approverAccountId: '660000000000000000000021', status: 'PENDING' },
      ],
      currentApprovalLevel: 1,
    });
    const advanced = {
      ...current,
      approvalChain: [
        {
          level: 1, approverAccountId: approver.accountId, status: 'APPROVED',
          actedByAccountId: approver.accountId, actedAt: new Date('2026-07-29T06:00:00.000Z'),
        },
        { level: 2, approverAccountId: '660000000000000000000021', status: 'PENDING' },
      ],
      currentApprovalLevel: 2,
      updatedAt: new Date('2026-07-29T06:00:00.000Z'),
    };
    authPublic.canAccessScope.mockReturnValue(true);
    repository.findRequestById.mockResolvedValue(current);
    repository.transitionRequest.mockResolvedValue(advanced);

    await service.approveRequest(requestId, scopedApprover);

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_LEAVE_APPROVAL_STEP_APPROVED',
      entityId: requestId,
      metadata: { profileId, leaveType: 'ANNUAL', approvalLevel: 1 },
      deduplicationKey: expect.stringContaining(':level:1'),
    }), { session });
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

  test('records a rejected leave mutation before a notification failure is returned', async () => {
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

  test('returns the persisted terminal result when an identical reject loses the transition race', async () => {
    repository.findRequestById
      .mockResolvedValueOnce(pendingRequest())
      .mockResolvedValueOnce(pendingRequest({ status: 'REJECTED' }));
    repository.transitionRequest.mockResolvedValue(null);

    await expect(service.rejectRequest(requestId, { reason: 'Coverage unavailable' }, approver))
      .resolves.toMatchObject({ status: 'REJECTED' });
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

  test('returns the persisted terminal result when an identical pending cancellation loses the race', async () => {
    repository.findRequestById
      .mockResolvedValueOnce(pendingRequest())
      .mockResolvedValueOnce(pendingRequest({ status: 'CANCELLED' }));
    repository.transitionRequest.mockResolvedValue(null);

    await expect(service.cancelRequest(requestId, { reason: 'Plans changed' }, requester))
      .resolves.toMatchObject({ status: 'CANCELLED' });
  });

  test('resolves a transferred requester organization from immutable snapshot IDs', async () => {
    repository.listRequests.mockResolvedValue({
      items: [pendingRequest(), pendingRequest({ _id: '660000000000000000000011' })],
      pagination: { page: 1, limit: 20, total: 2 },
    });

    const result = await service.listRequests({ own: true }, requester);

    expect(result.items[0]).toMatchObject({
      employee: { id: profileId, employeeCode: 'EMP001', fullName: 'Test Employee' },
      requester: {
        department: { id: departmentId, code: 'OPS', name: 'Operations' },
        team: { id: teamId, code: 'OPS-A', name: 'Operations A' },
      },
      capabilities: { view: true, edit: true, approve: false, reject: false, cancel: true },
    });
    expect(organizationPublic.listDepartmentsByIds).toHaveBeenCalledWith([departmentId]);
    expect(organizationPublic.listTeamsByIds).toHaveBeenCalledWith([teamId]);
    expect(organizationPublic.listAccountOrganizationSummaries).not.toHaveBeenCalled();
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

    expect(result.items[0].capabilities).toEqual({
      view: true, edit: false, approve: true, reject: true, cancel: false, attach: false, refund: false,
    });
    expect(result.items[1].capabilities).toEqual({
      view: true, edit: false, approve: false, reject: false, cancel: false, attach: false, refund: false,
    });
  });

  test('returns scoped summary counts for the full filtered result set, not the page', async () => {
    const scopedApprover = {
      accountId: approver.accountId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: teamId, permissions: ['HR_LEAVE:APPROVE'] }],
    };
    const summary = {
      total: 3,
      statusCounts: { PENDING: 2, APPROVED: 1, REJECTED: 0, CANCELLED: 0 },
    };
    authPublic.canAccessScope.mockImplementation((_auth, _permission, scope) => (
      scope.scopeType === 'team' && scope.scopeId === teamId
    ));
    repository.listRequests.mockResolvedValue({
      items: [pendingRequest()],
      pagination: { page: 1, limit: 1, total: 3 },
      summary,
    });

    const result = await service.listRequests({ page: 1, limit: 1 }, scopedApprover);

    expect(result.summary).toEqual(summary);
    expect(repository.listRequests).toHaveBeenCalledWith(expect.objectContaining({
      scopeFilters: [{ 'requesterSnapshot.teamId': teamId }],
    }));
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

  test('cancels from the current transaction state after a partial refund', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
    const stale = pendingRequest({ status: 'APPROVED' });
    const current = pendingRequest({
      status: 'APPROVED',
      startDateKey: '2026-07-21',
      requestedUnits: 2,
      workingDateSnapshots: [
        { dateKey: '2026-07-21', units: 2, scheduleSnapshot: { timezone: 'Asia/Ho_Chi_Minh' } },
      ],
    });
    repository.findRequestById.mockResolvedValueOnce(stale).mockResolvedValueOnce(current);
    repository.refundBalanceUnits.mockResolvedValue({ modifiedCount: 1 });
    repository.transitionRequest.mockResolvedValue({ ...current, status: 'CANCELLED' });
    authPublic.canAccessScope.mockReturnValue(true);
    const session = mockSession();

    await service.cancelRequest(requestId, { reason: 'Approved cancellation' }, approver);

    expect(repository.findRequestById).toHaveBeenLastCalledWith(requestId, { session });
    expect(repository.refundBalanceUnits).toHaveBeenCalledWith(
      profileId,
      2026,
      'ANNUAL',
      2,
      expect.objectContaining({ requestId, units: 2 }),
      { session },
    );
    jest.useRealTimers();
  });
});
