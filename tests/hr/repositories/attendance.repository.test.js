jest.mock('../../../src/modules/hr/models/attendanceDaily.model', () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

const mongoose = require('mongoose');
const AttendanceDaily = require('../../../src/modules/hr/models/attendanceDaily.model');
const repository = require('../../../src/modules/hr/repositories/attendance.repository');

describe('attendance repository', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns summary counts for the filtered attendance list', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    AttendanceDaily.find.mockReturnValue({ sort });
    AttendanceDaily.aggregate.mockResolvedValue([
      { _id: 'PRESENT', count: 1 },
      { _id: 'ABSENT', count: 1 },
    ]);

    const result = await repository.list({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      profileId: 'profile-1',
      page: 1,
      limit: 20,
    });

    const filter = {
      profileId: 'profile-1',
      workDateKey: { $gte: '2026-07-01', $lte: '2026-07-31' },
    };
    expect(AttendanceDaily.find).toHaveBeenCalledWith(filter);
    expect(AttendanceDaily.aggregate).toHaveBeenCalledWith([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    expect(AttendanceDaily.countDocuments).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      pagination: { page: 1, limit: 20, total: 2 },
      summary: {
        total: 2,
        statusCounts: expect.objectContaining({ PRESENT: 1, ABSENT: 1 }),
      },
    });
  });

  test('filters exceptions and authorization scopes before pagination', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    AttendanceDaily.find.mockReturnValue({ sort });
    AttendanceDaily.countDocuments.mockResolvedValue(0);

    await repository.list({
      exceptionsOnly: true,
      scopeFilters: [{ 'scheduleSnapshot.teamId': 'team-1' }],
      page: 2,
      limit: 20,
    });

    expect(AttendanceDaily.find).toHaveBeenCalledWith({
      $and: [
        { $or: [{ 'scheduleSnapshot.teamId': 'team-1' }] },
        {
          $or: [
            { status: { $ne: 'PRESENT' } },
            { lateMinutes: { $gt: 0 } },
            { earlyLeaveMinutes: { $gt: 0 } },
          ],
        },
      ],
    });
    expect(skip).toHaveBeenCalledWith(20);
  });

  test('casts valid scoped team ids before using them in the aggregate summary', async () => {
    const teamId = '660000000000000000000004';
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    AttendanceDaily.find.mockReturnValue({ sort });
    AttendanceDaily.aggregate.mockResolvedValue([]);

    await repository.list({ scopeFilters: [{ 'scheduleSnapshot.teamId': teamId }] });

    expect(AttendanceDaily.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $match: {
          $and: [{ $or: [{ 'scheduleSnapshot.teamId': expect.any(mongoose.Types.ObjectId) }] }],
        },
      }),
    ]));
  });

  test('casts profile ids to ObjectIds before aggregating the month summary', async () => {
    const profileId = '660000000000000000000001';
    AttendanceDaily.aggregate.mockResolvedValue([{
      _id: 'ERROR', count: 2, manualAdjustmentCount: 1, lateCount: 1,
    }]);

    const result = await repository.summarizeByProfileIdsAndDateRange(
      [profileId],
      '2026-07-01',
      '2026-07-31',
    );

    expect(AttendanceDaily.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $match: expect.objectContaining({
          profileId: { $in: [expect.any(mongoose.Types.ObjectId)] },
        }),
      }),
    ]));
    expect(result).toEqual({
      totalRecords: 2,
      statusCounts: { ERROR: 2 },
      manualAdjustmentCount: 1,
      lateCount: 1,
    });
  });
});
