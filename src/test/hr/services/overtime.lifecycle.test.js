const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn().mockReturnValue(false),
  getCurrentAccount: jest.fn().mockResolvedValue({ account: { email: 'task-five.approver@lng.co' } }),
}));
jest.mock('../../../modules/organization/public', () => ({
  listDepartmentsByIds: jest.fn().mockResolvedValue([]),
  listTeamsByIds: jest.fn().mockResolvedValue([]),
  listTeamMembers: jest.fn().mockResolvedValue({ leaders: [], members: [] }),
}));
jest.mock('../../../modules/hr/services/scheduleResolver.service', () => ({ resolveWorkContext: jest.fn() }));

const AttendanceDaily = require('../../../modules/hr/models/attendanceDaily.model');
const AuditEvent = require('../../../modules/audit/models/auditEvent.model');
const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const Notification = require('../../../modules/notification/models/notification.model');
const OvertimeRequest = require('../../../modules/hr/models/overtimeRequest.model');
const service = require('../../../modules/hr/services/overtime.service');

const profileId = new mongoose.Types.ObjectId('671000000000000000000001');
const requesterId = new mongoose.Types.ObjectId('671000000000000000000002');
const approverId = new mongoose.Types.ObjectId('671000000000000000000003');
const departmentId = new mongoose.Types.ObjectId('671000000000000000000004');
const teamId = new mongoose.Types.ObjectId('671000000000000000000005');
const locationId = new mongoose.Types.ObjectId('671000000000000000000006');
const shiftId = new mongoose.Types.ObjectId('671000000000000000000007');
const assignmentId = new mongoose.Types.ObjectId('671000000000000000000008');
const requesterAuth = { accountId: String(requesterId), permissions: ['HR_OVERTIME:WRITE'], scopes: [] };
const approverAuth = { accountId: String(approverId), permissions: ['HR_OVERTIME:APPROVE'], scopes: [] };

function scheduleSnapshot() {
  return {
    assignmentId,
    departmentId,
    teamId,
    timezone: 'Asia/Ho_Chi_Minh',
    calendarStatus: 'WORKING_DAY',
    workLocation: { id: locationId, code: 'HCM', name: 'HCM Office' },
    shift: {
      id: shiftId,
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

async function seedRequest(overrides = {}) {
  return OvertimeRequest.create({
    profileId,
    accountId: requesterId,
    workDateKey: '2026-12-15',
    plannedStartTime: '18:00',
    plannedEndTime: '20:00',
    plannedStartAt: new Date('2026-12-15T11:00:00.000Z'),
    plannedEndAt: new Date('2026-12-15T13:00:00.000Z'),
    startMinute: 1080,
    endMinute: 1200,
    requestedMinutes: 120,
    calendarClass: 'WORKDAY',
    conflictMinuteKeys: [1, 2],
    requesterSnapshot: {
      accountId: requesterId,
      profileId,
      employeeCode: 'T5-OT',
      fullName: 'Task Five OT Employee',
      departmentId,
      teamId,
    },
    scheduleSnapshot: scheduleSnapshot(),
    reason: 'Task 5 overtime proof',
    ...overrides,
  });
}

let mongo;
jest.setTimeout(120000);

describe('overtime persisted lifecycle', () => {
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri('lng_web_be_task5_ot_test'));
    await Promise.all([
      AttendanceDaily.init(), AuditEvent.init(), EmployeeProfile.init(), Notification.init(), OvertimeRequest.init(),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      AttendanceDaily.deleteMany({}), AuditEvent.deleteMany({}), EmployeeProfile.deleteMany({}), Notification.deleteMany({}), OvertimeRequest.deleteMany({}),
    ]);
    jest.clearAllMocks();
    await EmployeeProfile.create({
      _id: profileId,
      accountId: requesterId,
      employeeCode: 'T5-OT',
      fullName: 'Task Five OT Employee',
      departmentId,
      teamId,
      status: 'ACTIVE',
    });
  });

  test('repeated approval persists one outcome and never changes attendance workDayValue', async () => {
    const request = await seedRequest();
    await AttendanceDaily.create({
      profileId,
      workDateKey: '2026-12-15',
      status: 'PRESENT',
      workDayValue: 0.875,
      source: 'MANAGED',
      isManualEdited: true,
      scheduleSnapshot: {
        ...scheduleSnapshot(),
        plannedStartAt: new Date('2026-12-15T01:00:00.000Z'),
        plannedEndAt: new Date('2026-12-15T10:00:00.000Z'),
      },
    });

    await service.approveRequest(String(request._id), { approvedMinutes: 90 }, approverAuth);
    await service.approveRequest(String(request._id), { approvedMinutes: 90 }, approverAuth);

    const [saved, attendance, inbox, audits] = await Promise.all([
      OvertimeRequest.findById(request._id).lean(),
      AttendanceDaily.findOne({ profileId, workDateKey: '2026-12-15' }).lean(),
      Notification.find({ recipientAccountId: requesterId }).lean(),
      AuditEvent.find({ entityType: 'HR_OVERTIME_REQUEST', entityId: String(request._id), action: 'APPROVED' }).lean(),
    ]);
    expect(saved).toMatchObject({ status: 'APPROVED', approvedMinutes: 90 });
    expect(attendance.workDayValue).toBe(0.875);
    expect(inbox).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  test('terminal approval persists the immutable six-class approved minute allocation', async () => {
    const request = await seedRequest({
      plannedStartTime: '21:30',
      plannedEndTime: '22:30',
      plannedStartAt: new Date('2026-12-15T14:30:00.000Z'),
      plannedEndAt: new Date('2026-12-15T15:30:00.000Z'),
      startMinute: 1290,
      endMinute: 1350,
      requestedMinutes: 60,
      conflictMinuteKeys: [1290, 1291],
    });

    await service.approveRequest(String(request._id), { approvedMinutes: 60 }, approverAuth);
    await service.approveRequest(String(request._id), { approvedMinutes: 60 }, approverAuth);

    expect((await OvertimeRequest.findById(request._id).lean()).approvedRateMinutes).toEqual({
      weekday: 30, weekend: 0, holiday: 0,
      weekday_night: 30, weekend_night: 0, holiday_night: 0,
    });
  });

  test.each([
    ['rejectRequest', 'REJECTED', approverAuth],
    ['cancelRequest', 'CANCELLED', requesterAuth],
  ])('%s is retry-safe and persists one terminal outcome', async (method, status, authContext) => {
    const request = await seedRequest();
    await service[method](String(request._id), { reason: 'Lifecycle decision' }, authContext);
    await service[method](String(request._id), { reason: 'Lifecycle decision' }, authContext);

    const [saved, inbox] = await Promise.all([
      OvertimeRequest.findById(request._id).lean(),
      Notification.find({ recipientAccountId: requesterId }).lean(),
    ]);
    expect(saved.status).toBe(status);
    expect(inbox).toHaveLength(1);
  });
});
