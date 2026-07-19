jest.mock('../../../modules/hr/models/attendanceDaily.model', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

const AttendanceDaily = require('../../../modules/hr/models/attendanceDaily.model');
const repository = require('../../../modules/hr/repositories/attendance.repository');

describe('attendance repository', () => {
  test('returns summary counts for the filtered attendance list', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    AttendanceDaily.find.mockReturnValue({ sort });
    AttendanceDaily.countDocuments
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

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
    expect(AttendanceDaily.countDocuments).toHaveBeenNthCalledWith(1, filter);
    expect(AttendanceDaily.countDocuments).toHaveBeenNthCalledWith(2, { $and: [filter, { status: 'PRESENT' }] });
    expect(result).toEqual({
      items: [],
      pagination: { page: 1, limit: 20, total: 2 },
      summary: {
        total: 2,
        statusCounts: expect.objectContaining({ PRESENT: 1 }),
      },
    });
  });
});
