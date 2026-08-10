const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AttendanceDaily = require('../../../src/modules/hr/models/attendanceDaily.model');
const EmployeeProfile = require('../../../src/modules/hr/models/employeeProfile.model');
const LeaveRequest = require('../../../src/modules/hr/models/leaveRequest.model');
const OvertimeRequest = require('../../../src/modules/hr/models/overtimeRequest.model');
const service = require('../../../src/modules/hr/services/hrDashboard.service');
const { toHrDashboardDto } = require('../../../src/modules/hr/dtos/hrDashboard.dto');
const controller = require('../../../src/modules/hr/controllers/hrDashboard.controller');

let mongo;
jest.setTimeout(120000);

describe('HR dashboard persisted aggregates', () => {
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { dbName: 'task7_dashboard_test' } });
    await mongoose.connect(mongo.getUri('task7_dashboard_test'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      AttendanceDaily.deleteMany({}), EmployeeProfile.deleteMany({}),
      LeaveRequest.deleteMany({}), OvertimeRequest.deleteMany({}),
    ]);
  });

  test('returns the legacy overview DTO from repository aggregates', async () => {
    const ids = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
    const accounts = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
    await EmployeeProfile.insertMany([
      { _id: ids[0], accountId: accounts[0], employeeCode: 'DASH-1', fullName: 'Active', status: 'ACTIVE' },
      { _id: ids[1], accountId: accounts[1], employeeCode: 'DASH-2', fullName: 'Probation', status: 'PROBATION' },
      { _id: ids[2], accountId: accounts[2], employeeCode: 'DASH-3', fullName: 'Leave', status: 'ON_LEAVE' },
      { _id: ids[3], accountId: accounts[3], employeeCode: 'DASH-4', fullName: 'Suspended', status: 'SUSPENDED' },
    ]);
    await AttendanceDaily.collection.insertMany([
      { profileId: ids[0], workDateKey: '2026-07-27', status: 'PRESENT', checkInAt: new Date(), checkOutAt: null, lateMinutes: 15 },
      { profileId: ids[1], workDateKey: '2026-07-27', status: 'ABSENT', checkInAt: null, checkOutAt: null, lateMinutes: 0 },
      { profileId: ids[2], workDateKey: '2026-07-27', status: 'PAID_LEAVE', checkInAt: null, checkOutAt: null, lateMinutes: 0 },
    ]);
    await LeaveRequest.collection.insertMany([
      { profileId: ids[0], status: 'PENDING' },
      { profileId: ids[1], status: 'PENDING' },
      { profileId: ids[2], status: 'APPROVED' },
    ]);
    await OvertimeRequest.collection.insertMany([
      { profileId: ids[0], status: 'PENDING', workDateKey: '2026-07-28' },
      { profileId: ids[1], status: 'APPROVED', workDateKey: '2026-07-27' },
      { profileId: ids[2], status: 'APPROVED', workDateKey: '2026-07-26' },
    ]);

    const readModel = await service.getDashboard({ dateKey: '2026-07-27' });
    expect(readModel).toEqual({
      dateKey: '2026-07-27',
      employeeStats: { total: 4, active: 1, probation: 1, onLeave: 1 },
      attendanceStats: { records: 3, present: 1, late: 1, absent: 1, onLeave: 1, missingCheckOuts: 1 },
      approvalStats: { pendingLeaves: 2, pendingOvertimes: 1, approvedOvertimesToday: 1 },
    });
    expect(toHrDashboardDto(readModel)).toEqual({
      date: '2026-07-27',
      employees: { total: 4, active: 1, probation: 1, onLeave: 1, activeScope: ['ACTIVE', 'PROBATION', 'ON_LEAVE'] },
      attendance: {
        expectedEmployees: 3, records: 3, present: 1, late: 1, absent: 1,
        onLeave: 1, missingCheckOuts: 1, coverageRate: 100,
      },
      approvals: { pendingLeaves: 2, pendingOvertimes: 1, totalPending: 3, approvedOvertimesToday: 1 },
    });
  });

  test('controller defaults to the Ho Chi Minh date and returns only the public dashboard DTO', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T18:30:00.000Z'));
    const getDashboard = jest.spyOn(service, 'getDashboard').mockResolvedValue({
      dateKey: '2026-07-27',
      employeeStats: { total: 1, active: 1, probation: 0, onLeave: 0 },
      attendanceStats: { records: 1, present: 1, late: 0, absent: 0, onLeave: 0, missingCheckOuts: 0 },
      approvalStats: { pendingLeaves: 0, pendingOvertimes: 0, approvedOvertimesToday: 0 },
      internalEvidence: { mongoPipeline: true },
    });
    const res = {
      statusCode: null, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    try {
      await controller.getDashboard({ query: {} }, res);
      expect(getDashboard).toHaveBeenCalledWith({ dateKey: '2026-07-27' });
      expect(res).toMatchObject({
        statusCode: 200,
        body: {
          success: true,
          data: {
            date: '2026-07-27',
            employees: { total: 1, active: 1, probation: 0, onLeave: 0, activeScope: ['ACTIVE', 'PROBATION', 'ON_LEAVE'] },
            attendance: {
              expectedEmployees: 1, records: 1, present: 1, late: 0, absent: 0,
              onLeave: 0, missingCheckOuts: 0, coverageRate: 100,
            },
            approvals: { pendingLeaves: 0, pendingOvertimes: 0, totalPending: 0, approvedOvertimesToday: 0 },
          },
        },
      });
      expect(res.body.data).not.toHaveProperty('internalEvidence');
    } finally {
      getDashboard.mockRestore();
      jest.useRealTimers();
    }
  });

  test('returns a seven-day attendance trend ending on dateKey', async () => {
    const profileId = new mongoose.Types.ObjectId();
    await AttendanceDaily.collection.insertMany([
      { profileId, workDateKey: '2026-07-26', status: 'ABSENT', lateMinutes: 0 },
      { profileId, workDateKey: '2026-07-27', status: 'PRESENT', lateMinutes: 5 },
    ]);

    const dto = toHrDashboardDto(await service.getDashboard({ dateKey: '2026-07-27', days: 7 }));

    expect(dto.rangeDays).toBe(7);
    expect(dto.attendanceTrend).toHaveLength(7);
    expect(dto.attendanceTrend.slice(-2)).toEqual([
      expect.objectContaining({ date: '2026-07-26', absent: 1 }),
      expect.objectContaining({ date: '2026-07-27', present: 1, late: 1 }),
    ]);
  });
});
