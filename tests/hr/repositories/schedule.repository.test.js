const ShiftAssignment = require('../../../src/modules/hr/models/shiftAssignment.model');
const CalendarOverride = require('../../../src/modules/hr/models/calendarOverride.model');
const repository = require('../../../src/modules/hr/repositories/schedule.repository');

describe('schedule repository', () => {
  beforeEach(() => {
    jest.spyOn(ShiftAssignment, 'countDocuments');
    jest.spyOn(ShiftAssignment, 'find');
    jest.spyOn(ShiftAssignment, 'findOne');
    jest.spyOn(CalendarOverride, 'countDocuments');
    jest.spyOn(CalendarOverride, 'find');
  });

  afterEach(() => jest.restoreAllMocks());

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

  test('applies assignment profile IDs before pagination, count, and status counts', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    ShiftAssignment.find.mockReturnValue({ sort });
    ShiftAssignment.countDocuments.mockResolvedValue(1);

    await repository.listAssignments({ page: 1, limit: 1, profileIds: ['profile-1'] });

    expect(ShiftAssignment.find).toHaveBeenCalledWith({ profileId: { $in: ['profile-1'] } });
    expect(ShiftAssignment.countDocuments).toHaveBeenCalledWith({ profileId: { $in: ['profile-1'] } });
    expect(ShiftAssignment.countDocuments).toHaveBeenCalledWith({
      $and: [{ profileId: { $in: ['profile-1'] } }, { status: 'ACTIVE' }],
    });
    expect(ShiftAssignment.countDocuments).toHaveBeenCalledWith({
      $and: [{ profileId: { $in: ['profile-1'] } }, { status: 'SUSPENDED' }],
    });
    expect(skip).toHaveBeenCalledWith(0);
  });

  test('intersects requested assignment profile with scoped profile IDs', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    ShiftAssignment.find.mockReturnValue({ sort });
    ShiftAssignment.countDocuments.mockResolvedValue(0);
    const filter = {
      $and: [
        { profileId: 'profile-1' },
        { profileId: { $in: ['profile-1', 'profile-2'] } },
      ],
    };

    await repository.listAssignments({ page: 1, limit: 1, profileId: 'profile-1', profileIds: ['profile-1', 'profile-2'] });

    expect(ShiftAssignment.find).toHaveBeenCalledWith(filter);
    expect(ShiftAssignment.countDocuments).toHaveBeenCalledWith(filter);
  });

  test('filters assignments that overlap the requested effective date range', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    ShiftAssignment.find.mockReturnValue({ sort });
    ShiftAssignment.countDocuments.mockResolvedValue(0);

    await repository.listAssignments({
      page: 1,
      limit: 20,
      effectiveFrom: '2026-07-01',
      effectiveTo: '2026-07-31',
    });

    expect(ShiftAssignment.find).toHaveBeenCalledWith({
      effectiveFrom: { $lte: '2026-07-31' },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: '2026-07-01' } }],
    });
  });

  test('applies override scope filters before pagination and count', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    CalendarOverride.find.mockReturnValue({ sort });
    CalendarOverride.countDocuments.mockResolvedValue(1);
    const scopeFilters = [{ scopeType: 'PROFILE', scopeId: { $in: ['profile-1'] } }];

    await repository.listCalendarOverrides({ page: 1, limit: 1, scopeFilters });

    expect(CalendarOverride.find).toHaveBeenCalledWith({ $or: scopeFilters });
    expect(CalendarOverride.countDocuments).toHaveBeenCalledWith({ $or: scopeFilters });
    expect(skip).toHaveBeenCalledWith(0);
  });
});
