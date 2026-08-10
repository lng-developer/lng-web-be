const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(() => true),
  getCurrentAccount: jest.fn().mockResolvedValue({ account: { email: 'hr@lng.co' } }),
}));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn().mockResolvedValue({}) }));
jest.mock('../../../src/modules/organization/public', () => ({}));
jest.mock('../../../src/modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn().mockResolvedValue(null),
}));

const CalendarOverride = require('../../../src/modules/hr/models/calendarOverride.model');
const service = require('../../../src/modules/hr/services/schedule.service');

describe('calendar override duplicate race', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri());
    await CalendarOverride.init();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  afterEach(() => CalendarOverride.deleteMany({}));

  test('allows only one concurrent active override for the same date and scope', async () => {
    const payload = {
      dateKey: '2026-09-02', kind: 'HOLIDAY', scopeType: 'GLOBAL',
      scopeId: null, name: 'National Day', status: 'ACTIVE',
    };
    const auth = {
      accountId: String(new mongoose.Types.ObjectId()),
      permissions: ['HR_SCHEDULE:WRITE'],
    };

    const results = await Promise.allSettled([
      service.createCalendarOverride(payload, auth),
      service.createCalendarOverride(payload, auth),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find(({ status }) => status === 'rejected').reason)
      .toMatchObject({ code: 'CONFLICT_ERROR' });
    await expect(CalendarOverride.countDocuments({ status: 'ACTIVE' })).resolves.toBe(1);
  });
});
