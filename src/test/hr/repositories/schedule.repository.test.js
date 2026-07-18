jest.mock('../../../modules/hr/models/shiftAssignment.model', () => ({
  findOne: jest.fn(),
}), { virtual: true });

jest.mock('../../../modules/hr/models/calendarOverride.model', () => ({
  find: jest.fn(),
}), { virtual: true });

const ShiftAssignment = require('../../../modules/hr/models/shiftAssignment.model');
const CalendarOverride = require('../../../modules/hr/models/calendarOverride.model');
const repository = require('../../../modules/hr/repositories/schedule.repository');

describe('schedule repository', () => {
  test('finds the latest active assignment covering a local work date as lean data', async () => {
    const lean = jest.fn().mockResolvedValue({ id: 'assignment-1' });
    const sort = jest.fn().mockReturnValue({ lean });
    ShiftAssignment.findOne.mockReturnValue({ sort });

    await repository.findEffectiveAssignment('profile-1', '2026-07-18');

    expect(ShiftAssignment.findOne).toHaveBeenCalledWith({
      profileId: 'profile-1',
      status: 'ACTIVE',
      effectiveFrom: { $lte: '2026-07-18' },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: '2026-07-18' } }],
    });
    expect(sort).toHaveBeenCalledWith({ effectiveFrom: -1, _id: -1 });
    expect(lean).toHaveBeenCalledTimes(1);
  });

  test('returns all active date overrides applicable to schedule context as lean data', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    CalendarOverride.find.mockReturnValue({ lean });
    const context = {
      profileId: 'profile-1',
      workLocationId: 'location-1',
      departmentId: 'department-1',
      teamId: 'team-1',
    };

    await repository.findCalendarOverrides('2026-07-18', context);

    expect(CalendarOverride.find).toHaveBeenCalledWith({
      dateKey: '2026-07-18',
      status: 'ACTIVE',
      $or: [
        { scopeType: 'GLOBAL', scopeId: null },
        { scopeType: 'WORK_LOCATION', scopeId: 'location-1' },
        { scopeType: 'DEPARTMENT', scopeId: 'department-1' },
        { scopeType: 'TEAM', scopeId: 'team-1' },
        { scopeType: 'PROFILE', scopeId: 'profile-1' },
      ],
    });
    expect(lean).toHaveBeenCalledTimes(1);
  });
});
