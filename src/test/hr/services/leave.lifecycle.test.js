const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  getCurrentAccount: jest.fn(),
}));
jest.mock('../../../modules/organization/public', () => ({
  listDepartmentsByIds: jest.fn().mockResolvedValue([]),
  listTeamsByIds: jest.fn().mockResolvedValue([]),
  listTeamMembers: jest.fn(),
}));
jest.mock('../../../modules/hr/services/scheduleResolver.service', () => ({
  resolveWorkContext: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const organizationPublic = require('../../../modules/organization/public');
const resolver = require('../../../modules/hr/services/scheduleResolver.service');
const AttendanceDaily = require('../../../modules/hr/models/attendanceDaily.model');
const AuditEvent = require('../../../modules/audit/models/auditEvent.model');
const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const LeaveBalance = require('../../../modules/hr/models/leaveBalance.model');
const LeaveRequest = require('../../../modules/hr/models/leaveRequest.model');
const Notification = require('../../../modules/notification/models/notification.model');
const service = require('../../../modules/hr/services/leave.service');

const ids = {
  profile: new mongoose.Types.ObjectId('670000000000000000000001'),
  requester: new mongoose.Types.ObjectId('670000000000000000000002'),
  approver: new mongoose.Types.ObjectId('670000000000000000000003'),
  nextApprover: new mongoose.Types.ObjectId('670000000000000000000004'),
  department: new mongoose.Types.ObjectId('670000000000000000000005'),
  team: new mongoose.Types.ObjectId('670000000000000000000006'),
  assignment: new mongoose.Types.ObjectId('670000000000000000000007'),
  location: new mongoose.Types.ObjectId('670000000000000000000008'),
  shift: new mongoose.Types.ObjectId('670000000000000000000009'),
};

const requesterAuth = { accountId: String(ids.requester), permissions: ['HR_LEAVE:WRITE'], scopes: [] };
const approverAuth = { accountId: String(ids.approver), permissions: ['HR_LEAVE:APPROVE'], scopes: [] };

function scheduleSnapshot() {
  return {
    assignmentId: ids.assignment,
    departmentId: ids.department,
    teamId: ids.team,
    timezone: 'Asia/Ho_Chi_Minh',
    calendarStatus: 'WORKING_DAY',
    workLocation: { id: ids.location, code: 'HCM', name: 'HCM Office' },
    shift: {
      id: ids.shift,
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

function workContext(workDateKey) {
  const snapshot = scheduleSnapshot();
  return {
    status: 'WORKING_DAY',
    isWorkingDay: true,
    workDateKey,
    assignment: { id: ids.assignment },
    workLocation: snapshot.workLocation,
    shift: snapshot.shift,
    calendarOverride: null,
  };
}

async function seedProfile() {
  await EmployeeProfile.create({
    _id: ids.profile,
    accountId: ids.requester,
    employeeCode: 'T5-EMP',
    fullName: 'Task Five Employee',
    departmentId: ids.department,
    teamId: ids.team,
    status: 'ACTIVE',
  });
}

async function seedRequest({
  dateKey = '2026-12-15',
  dateKeys = [dateKey],
  leaveType = 'ANNUAL',
  portion = 'FULL_DAY',
  approvalChain,
} = {}) {
  const units = portion === 'FULL_DAY' ? 2 : 1;
  return LeaveRequest.create({
    profileId: ids.profile,
    accountId: ids.requester,
    year: 2026,
    leaveType,
    attendanceStatus: ['UNPAID', 'PERSONAL_UNPAID'].includes(leaveType) ? 'UNPAID_LEAVE' : 'PAID_LEAVE',
    portion,
    startDateKey: dateKeys[0],
    endDateKey: dateKeys.at(-1),
    workingDateKeys: dateKeys,
    conflictKeys: dateKeys.flatMap((key) => (portion === 'FULL_DAY'
      ? [`${key}:MORNING`, `${key}:AFTERNOON`]
      : [`${key}:${portion}`])),
    workingDateSnapshots: dateKeys.map((key) => ({ dateKey: key, units, scheduleSnapshot: scheduleSnapshot() })),
    requestedUnits: units * dateKeys.length,
    requesterSnapshot: {
      accountId: ids.requester,
      profileId: ids.profile,
      employeeCode: 'T5-EMP',
      fullName: 'Task Five Employee',
      departmentId: ids.department,
      teamId: ids.team,
    },
    reason: 'Task 5 lifecycle proof',
    approvalChain,
  });
}

let mongo;

jest.setTimeout(120000);

describe('leave persisted lifecycle', () => {
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri('lng_web_be_task5_test'));
    await Promise.all([
      AttendanceDaily.init(),
      AuditEvent.init(),
      EmployeeProfile.init(),
      LeaveBalance.init(),
      LeaveRequest.init(),
      Notification.init(),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      AttendanceDaily.deleteMany({}),
      AuditEvent.deleteMany({}),
      EmployeeProfile.deleteMany({}),
      LeaveBalance.deleteMany({}),
      LeaveRequest.deleteMany({}),
      Notification.deleteMany({}),
    ]);
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(false);
    authPublic.getCurrentAccount.mockResolvedValue({ profile: { fullName: 'Task Five Approver' } });
    organizationPublic.listTeamMembers.mockResolvedValue({ leaders: [], members: [] });
    resolver.resolveWorkContext.mockImplementation(async ({ workDateKey }) => workContext(workDateKey));
    await seedProfile();
  });

  test('repeated approval persists one debit, attendance projection, audit event and inbox item', async () => {
    const request = await seedRequest();
    await LeaveBalance.create({
      profileId: ids.profile,
      year: 2026,
      leaveType: 'ANNUAL',
      entitledUnits: 24,
    });

    await service.approveRequest(String(request._id), approverAuth);
    await service.approveRequest(String(request._id), approverAuth);

    const [savedRequest, balance, attendance, notifications, audits] = await Promise.all([
      LeaveRequest.findById(request._id).lean(),
      LeaveBalance.findOne({ profileId: ids.profile, year: 2026, leaveType: 'ANNUAL' }).lean(),
      AttendanceDaily.find({ 'leaveSegments.requestId': request._id }).lean(),
      Notification.find({ recipientAccountId: ids.requester }).lean(),
      AuditEvent.find({ entityType: 'HR_LEAVE_REQUEST', entityId: String(request._id), action: 'APPROVED' }).lean(),
    ]);
    expect(savedRequest).toMatchObject({ status: 'APPROVED' });
    expect(balance.usedUnits).toBe(2);
    expect(attendance).toHaveLength(1);
    expect(attendance[0]).toMatchObject({ status: 'PAID_LEAVE', workDayValue: 1 });
    expect(notifications).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  test('approval consumes a pre-migration balance that has no carried-over field', async () => {
    const request = await seedRequest();
    await LeaveBalance.collection.insertOne({
      profileId: ids.profile,
      year: 2026,
      leaveType: 'ANNUAL',
      entitledUnits: 24,
      adjustmentUnits: 0,
      usedUnits: 0,
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.approveRequest(String(request._id), approverAuth);

    await expect(LeaveBalance.findOne({ profileId: ids.profile, year: 2026, leaveType: 'ANNUAL' }).lean())
      .resolves.toMatchObject({ usedUnits: 2 });
  });

  test.each([
    ['UNPAID', 'FULL_DAY', 'UNPAID_LEAVE', 0],
    ['ANNUAL', 'MORNING', 'PAID_LEAVE', 0.4375],
  ])('projects %s %s leave with the correct paid value', async (leaveType, portion, status, workDayValue) => {
    const request = await seedRequest({ leaveType, portion });
    if (leaveType === 'ANNUAL') {
      await LeaveBalance.create({
        profileId: ids.profile, year: 2026, leaveType, entitledUnits: 24,
      });
    }

    await service.approveRequest(String(request._id), approverAuth);

    await expect(AttendanceDaily.findOne({ 'leaveSegments.requestId': request._id }).lean())
      .resolves.toMatchObject({ status, workDayValue });
    if (leaveType === 'UNPAID') {
      await expect(LeaveBalance.countDocuments({ profileId: ids.profile, leaveType })).resolves.toBe(0);
    }
  });

  test('manual attendance keeps precedence when paid half-day leave is approved', async () => {
    const request = await seedRequest({ portion: 'MORNING' });
    await LeaveBalance.create({
      profileId: ids.profile, year: 2026, leaveType: 'ANNUAL', entitledUnits: 24,
    });
    await AttendanceDaily.create({
      profileId: ids.profile,
      workDateKey: '2026-12-15',
      status: 'PRESENT',
      workDayValue: 0.75,
      calculationReason: 'MANUAL',
      source: 'MANAGED',
      isManualEdited: true,
      scheduleSnapshot: {
        ...scheduleSnapshot(),
        plannedStartAt: new Date('2026-12-15T01:00:00.000Z'),
        plannedEndAt: new Date('2026-12-15T10:00:00.000Z'),
      },
      manualAdjustments: [{
        actorId: ids.approver,
        reason: 'Verified timesheet',
        adjustedAt: new Date(),
        before: { status: 'ABSENT', workedMinutes: 0 },
        after: { status: 'PRESENT', workedMinutes: 360 },
      }],
    });

    await service.approveRequest(String(request._id), approverAuth);

    await expect(AttendanceDaily.findOne({ profileId: ids.profile, workDateKey: '2026-12-15' }).lean())
      .resolves.toMatchObject({ status: 'PRESENT', workDayValue: 0.75, isManualEdited: true });
  });

  test('cancelling approved leave refunds only its debit and reverses only its projection', async () => {
    const request = await seedRequest();
    await LeaveBalance.create({
      profileId: ids.profile, year: 2026, leaveType: 'ANNUAL', entitledUnits: 24,
    });
    await service.approveRequest(String(request._id), approverAuth);

    await service.cancelRequest(String(request._id), { reason: 'Coverage restored' }, approverAuth);
    await service.cancelRequest(String(request._id), { reason: 'Coverage restored' }, approverAuth);

    const [savedRequest, balance, attendance] = await Promise.all([
      LeaveRequest.findById(request._id).lean(),
      LeaveBalance.findOne({ profileId: ids.profile, year: 2026, leaveType: 'ANNUAL' }).lean(),
      AttendanceDaily.find({ 'leaveSegments.requestId': request._id }).lean(),
    ]);
    expect(savedRequest.status).toBe('CANCELLED');
    expect(balance.usedUnits).toBe(0);
    expect(attendance).toHaveLength(0);
  });

  test('distinct partial refunds append distinct audits while canonical replays stay deduplicated', async () => {
    const request = await seedRequest({
      dateKeys: ['2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19'],
    });
    await LeaveBalance.create({
      profileId: ids.profile, year: 2026, leaveType: 'ANNUAL', entitledUnits: 24,
    });
    await service.approveRequest(String(request._id), approverAuth);

    await service.refundRequest(String(request._id), {
      dateKeys: ['2026-12-16', '2026-12-17'], reason: 'Employee worked these days',
    }, approverAuth);
    await service.refundRequest(String(request._id), {
      dateKeys: ['2026-12-17', '2026-12-16'], reason: 'Employee worked these days',
    }, approverAuth);
    await service.refundRequest(String(request._id), {
      dateKeys: ['2026-12-18'], reason: 'Employee worked this day',
    }, approverAuth);
    await service.refundRequest(String(request._id), {
      dateKeys: ['2026-12-18'], reason: 'Employee worked this day',
    }, approverAuth);

    const [saved, balance, attendance, audits] = await Promise.all([
      LeaveRequest.findById(request._id).lean(),
      LeaveBalance.findOne({ profileId: ids.profile, year: 2026, leaveType: 'ANNUAL' }).lean(),
      AttendanceDaily.find({ 'leaveSegments.requestId': request._id }).sort({ workDateKey: 1 }).lean(),
      AuditEvent.find({ entityType: 'HR_LEAVE_REQUEST', entityId: String(request._id), action: 'REFUNDED' }).lean(),
    ]);
    expect(saved).toMatchObject({
      status: 'APPROVED',
      startDateKey: '2026-12-15',
      endDateKey: '2026-12-19',
      requestedUnits: 4,
      refundedDateKeys: ['2026-12-16', '2026-12-17', '2026-12-18'],
    });
    expect(balance.usedUnits).toBe(4);
    expect(attendance.map((item) => item.workDateKey)).toEqual(['2026-12-15', '2026-12-19']);
    expect(audits.map(({ deduplicationKey }) => deduplicationKey).sort()).toEqual([
      `leave:${request._id}:REFUNDED:2026-12-16,2026-12-17`,
      `leave:${request._id}:REFUNDED:2026-12-18`,
    ]);
  });

  test('preview reports overlap without creating another request', async () => {
    await seedRequest();

    const preview = await service.previewRequest({
      leaveType: 'ANNUAL',
      portion: 'FULL_DAY',
      startDateKey: '2026-12-15',
      endDateKey: '2026-12-15',
      reason: 'Conflicting request',
    }, requesterAuth);

    expect(preview).toMatchObject({ isPossible: false, requestedUnits: 2, conflictCount: 1 });
    await expect(LeaveRequest.countDocuments({})).resolves.toBe(1);
  });

  test('a scoped first approver leaves the request pending and notifies the next approver', async () => {
    const request = await seedRequest({
      approvalChain: [
        { level: 1, approverAccountId: ids.approver, status: 'PENDING' },
        { level: 2, approverAccountId: ids.nextApprover, status: 'PENDING' },
      ],
    });
    await LeaveBalance.create({
      profileId: ids.profile, year: 2026, leaveType: 'ANNUAL', entitledUnits: 24,
    });
    authPublic.canAccessScope.mockReturnValue(true);
    const scopedApprover = {
      accountId: String(ids.approver),
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: String(ids.team), permissions: ['HR_LEAVE:APPROVE'] }],
    };

    await service.approveRequest(String(request._id), scopedApprover);

    const [savedRequest, nextInbox, attendance] = await Promise.all([
      LeaveRequest.findById(request._id).lean(),
      Notification.find({ recipientAccountId: ids.nextApprover }).lean(),
      AttendanceDaily.countDocuments({ 'leaveSegments.requestId': request._id }),
    ]);
    expect(savedRequest).toMatchObject({ status: 'PENDING', currentApprovalLevel: 2 });
    expect(savedRequest.approvalChain.map((step) => step.status)).toEqual(['APPROVED', 'PENDING']);
    expect(nextInbox).toHaveLength(1);
    expect(attendance).toBe(0);
  });

  test('balance adjustment and monthly accrual are atomic and retry-safe', async () => {
    await LeaveBalance.create({
      profileId: ids.profile, year: 2026, leaveType: 'ANNUAL', entitledUnits: 0,
    });

    await service.adjustBalance(
      String(ids.profile), 2026, 'ANNUAL', { units: 2, reason: 'Opening correction' }, approverAuth,
    );
    await service.accrueBalances({
      profileIds: [String(ids.profile)], year: 2026, month: 7, units: 2, reason: 'July accrual',
    }, approverAuth);
    await service.accrueBalances({
      profileIds: [String(ids.profile)], year: 2026, month: 7, units: 2, reason: 'July retry',
    }, approverAuth);

    await expect(LeaveBalance.findOne({ profileId: ids.profile, year: 2026, leaveType: 'ANNUAL' }).lean())
      .resolves.toMatchObject({ adjustmentUnits: 2, entitledUnits: 2, lastAccruedMonth: 7 });
  });

  test('monthly accrual creates a missing annual balance', async () => {
    await service.accrueBalances({
      profileIds: [String(ids.profile)], year: 2026, month: 7, units: 2, reason: 'July accrual',
    }, approverAuth);

    await expect(LeaveBalance.findOne({ profileId: ids.profile, year: 2026, leaveType: 'ANNUAL' }).lean())
      .resolves.toMatchObject({ entitledUnits: 2, lastAccruedMonth: 7, usedUnits: 0 });
  });

  test('monthly accrual upgrades a pre-migration balance without an accrual marker', async () => {
    await LeaveBalance.collection.insertOne({
      profileId: ids.profile,
      year: 2026,
      leaveType: 'ANNUAL',
      entitledUnits: 0,
      adjustmentUnits: 0,
      usedUnits: 0,
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.accrueBalances({
      profileIds: [String(ids.profile)], year: 2026, month: 7, units: 2, reason: 'July accrual',
    }, approverAuth);

    await expect(LeaveBalance.findOne({ profileId: ids.profile, year: 2026, leaveType: 'ANNUAL' }).lean())
      .resolves.toMatchObject({ entitledUnits: 2, lastAccruedMonth: 7 });
  });

  test('annual reset is deterministic and carry-over is capped and retry-safe', async () => {
    await LeaveBalance.create({
      profileId: ids.profile,
      year: 2025,
      leaveType: 'ANNUAL',
      entitledUnits: 24,
      usedUnits: 8,
    });

    await service.resetBalances({
      profileIds: [String(ids.profile)], year: 2026, leaveType: 'ANNUAL', entitledUnits: 24, reason: '2026 reset',
    }, approverAuth);
    await service.carryOverBalances({
      profileIds: [String(ids.profile)], fromYear: 2025, toYear: 2026, leaveType: 'ANNUAL', maxUnits: 10,
      reason: 'Carry over 2025',
    }, approverAuth);
    await service.carryOverBalances({
      profileIds: [String(ids.profile)], fromYear: 2025, toYear: 2026, leaveType: 'ANNUAL', maxUnits: 10,
      reason: 'Carry over retry',
    }, approverAuth);

    await expect(LeaveBalance.findOne({ profileId: ids.profile, year: 2026, leaveType: 'ANNUAL' }).lean())
      .resolves.toMatchObject({ entitledUnits: 24, adjustmentUnits: 0, usedUnits: 0, carriedOverUnits: 10 });
  });

  test('attachments store media references without accepting filesystem paths', async () => {
    const request = await seedRequest();

    const result = await service.attachReferences(String(request._id), {
      attachments: [{ mediaId: 'media-leave-1', filename: 'medical-note.pdf', mimeType: 'application/pdf' }],
    }, requesterAuth);

    expect(result.attachments).toEqual([{
      mediaId: 'media-leave-1', filename: 'medical-note.pdf', mimeType: 'application/pdf',
    }]);
    const saved = await LeaveRequest.findById(request._id).lean();
    expect(saved.attachments).toHaveLength(1);
    expect(JSON.stringify(saved.attachments)).not.toContain('uploads');
  });
});
