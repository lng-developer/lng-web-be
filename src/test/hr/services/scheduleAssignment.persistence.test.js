const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(() => true),
  getCurrentAccount: jest.fn(),
}));
jest.mock('../../../modules/audit/public', () => ({ record: jest.fn().mockResolvedValue({}) }));
jest.mock('../../../modules/organization/public', () => ({}));

const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const Shift = require('../../../modules/hr/models/shift.model');
const ShiftAssignment = require('../../../modules/hr/models/shiftAssignment.model');
const WorkLocation = require('../../../modules/hr/models/workLocation.model');
const service = require('../../../modules/hr/services/schedule.service');

describe('schedule assignment concurrency', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  afterEach(async () => {
    await Promise.all([
      EmployeeProfile.deleteMany({}), Shift.deleteMany({}),
      ShiftAssignment.deleteMany({}), WorkLocation.deleteMany({}),
    ]);
  });

  test('allows only one of two concurrent overlapping assignments', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const [profile, location] = await Promise.all([
      EmployeeProfile.create({
        accountId, employeeCode: 'EMP001', fullName: 'Schedule Test', status: 'ACTIVE',
        startDate: new Date('2026-07-01T00:00:00.000Z'),
      }),
      WorkLocation.create({ code: 'HCM', name: 'HCM Office', timezone: 'Asia/Ho_Chi_Minh' }),
    ]);
    const shift = await Shift.create({
      code: 'DAY', name: 'Day', workLocationId: location._id,
      startTime: '08:00', endTime: '17:00', breakMinutes: 60,
    });
    const payload = {
      profileId: String(profile._id), shiftId: String(shift._id),
      workLocationId: String(location._id), effectiveFrom: '2026-08-01',
    };

    const results = await Promise.allSettled([
      service.createAssignment(payload, { accountId: String(accountId), permissions: ['HR_SCHEDULE:WRITE'] }),
      service.createAssignment(payload, { accountId: String(accountId), permissions: ['HR_SCHEDULE:WRITE'] }),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find(({ status }) => status === 'rejected').reason).toMatchObject({ code: 'CONFLICT_ERROR' });
    await expect(ShiftAssignment.countDocuments({ status: 'ACTIVE' })).resolves.toBe(1);
  });
});
