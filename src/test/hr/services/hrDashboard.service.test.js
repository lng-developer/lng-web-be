const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AttendanceDaily = require('../../../modules/hr/models/attendanceDaily.model');
const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const LeaveRequest = require('../../../modules/hr/models/leaveRequest.model');
const OvertimeRequest = require('../../../modules/hr/models/overtimeRequest.model');
const service = require('../../../modules/hr/services/hrDashboard.service');

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

    await expect(service.getDashboard({ dateKey: '2026-07-27' })).resolves.toEqual({
      date: '2026-07-27',
      employees: { total: 4, active: 1, probation: 1, onLeave: 1, activeScope: ['ACTIVE', 'PROBATION', 'ON_LEAVE'] },
      attendance: {
        expectedEmployees: 3, records: 3, present: 1, late: 1, absent: 1,
        onLeave: 1, missingCheckOuts: 1, coverageRate: 100,
      },
      approvals: { pendingLeaves: 2, pendingOvertimes: 1, totalPending: 3, approvedOvertimesToday: 1 },
    });
  });
});
