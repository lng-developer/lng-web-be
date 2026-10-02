jest.mock('../../../src/modules/hr/repositories/employeeProfile.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/modules/hr/repositories/schedule.repository', () => ({
  findCalendarOverridesForDates: jest.fn(),
  findCalendarOverrides: jest.fn(),
  findEffectiveAssignment: jest.fn(),
  findShiftsByIds: jest.fn(),
  findShiftById: jest.fn(),
  findWorkLocationsByIds: jest.fn(),
  findWorkLocationById: jest.fn(),
  listAssignmentsEffectiveForProfiles: jest.fn(),
}));
jest.mock('../../../src/modules/hr/repositories/calendarPolicy.repository', () => ({
  findApplicable: jest.fn(),
  isRotationOff: jest.fn(),
  listHolidayRange: jest.fn(),
  listRotationsForProfileDates: jest.fn(),
}));

const profileRepository = require('../../../src/modules/hr/repositories/employeeProfile.repository');
const scheduleRepository = require('../../../src/modules/hr/repositories/schedule.repository');
const calendarPolicyRepository = require('../../../src/modules/hr/repositories/calendarPolicy.repository');
const { resolveWorkContext, resolveWorkContexts } = require('../../../src/modules/hr/services/scheduleResolver.service');

const input = { profileId: 'profile-1', workDateKey: '2026-07-18' };

function activeSchedule() {
  profileRepository.findById.mockResolvedValue({
    id: 'profile-1',
    status: 'ACTIVE',
    isDeleted: false,
    departmentId: 'department-1',
    teamId: 'team-1',
  });
  scheduleRepository.findEffectiveAssignment.mockResolvedValue({
    id: 'assignment-1',
    profileId: 'profile-1',
    shiftId: 'shift-1',
    workLocationId: 'location-1',
    status: 'ACTIVE',
  });
  scheduleRepository.findShiftById.mockResolvedValue({
    id: 'shift-1',
    code: 'NIGHT',
    name: 'Night Shift',
    startTime: '22:00',
    endTime: '06:00',
    breakMinutes: 30,
    graceMinutes: 10,
    workdays: [1, 2, 3, 4, 5],
    status: 'ACTIVE',
  });
  scheduleRepository.findWorkLocationById.mockResolvedValue({
    id: 'location-1',
    code: 'HCM',
    name: 'Ho Chi Minh',
    timezone: 'Asia/Ho_Chi_Minh',
    status: 'ACTIVE',
  });
  scheduleRepository.findCalendarOverrides.mockResolvedValue([]);
  calendarPolicyRepository.findApplicable.mockResolvedValue(null);
  calendarPolicyRepository.isRotationOff.mockResolvedValue(false);
}

describe('schedule resolver service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns SCHEDULE_UNRESOLVED when the profile has no effective assignment', async () => {
    profileRepository.findById.mockResolvedValue({ id: 'profile-1', status: 'ACTIVE', isDeleted: false });
    scheduleRepository.findEffectiveAssignment.mockResolvedValue(null);

    await expect(resolveWorkContext(input)).resolves.toEqual({
      status: 'SCHEDULE_UNRESOLVED',
      profileId: 'profile-1',
      workDateKey: '2026-07-18',
    });
    expect(scheduleRepository.findShiftById).not.toHaveBeenCalled();
  });

  test('uses the profile override before team, department, location, and global overrides', async () => {
    activeSchedule();
    scheduleRepository.findCalendarOverrides.mockResolvedValue([
      { id: 'global-1', scopeType: 'GLOBAL', kind: 'HOLIDAY', name: 'Global holiday' },
      { id: 'location-1', scopeType: 'WORK_LOCATION', kind: 'REST_DAY', name: 'Location rest' },
      { id: 'department-1', scopeType: 'DEPARTMENT', kind: 'HOLIDAY', name: 'Department holiday' },
      { id: 'team-1', scopeType: 'TEAM', kind: 'REST_DAY', name: 'Team rest' },
      { id: 'profile-override-1', scopeType: 'PROFILE', kind: 'WORKING_DAY', name: 'Profile make-up day' },
    ]);

    await expect(resolveWorkContext(input)).resolves.toMatchObject({
      status: 'WORKING_DAY',
      isWorkingDay: true,
      calendarOverride: {
        id: 'profile-override-1',
        scopeType: 'PROFILE',
        kind: 'WORKING_DAY',
      },
    });
  });

  test('uses a holiday override and a make-up workday over the shift weekday set', async () => {
    activeSchedule();
    scheduleRepository.findCalendarOverrides.mockResolvedValue([
      { id: 'holiday-1', scopeType: 'GLOBAL', kind: 'HOLIDAY', name: 'Holiday' },
    ]);

    await expect(resolveWorkContext(input)).resolves.toMatchObject({
      status: 'HOLIDAY',
      isWorkingDay: false,
      calendarOverride: { id: 'holiday-1', kind: 'HOLIDAY' },
    });

    scheduleRepository.findCalendarOverrides.mockResolvedValue([
      { id: 'make-up-1', scopeType: 'GLOBAL', kind: 'WORKING_DAY', name: 'Make-up day' },
    ]);

    await expect(resolveWorkContext(input)).resolves.toMatchObject({
      status: 'WORKING_DAY',
      isWorkingDay: true,
      calendarOverride: { id: 'make-up-1', kind: 'WORKING_DAY' },
    });
  });

  test.each([
    ['override before holiday and rotation', { kind: 'WORKING_DAY', scopeType: 'TEAM' }, { isWorkDay: false }, true, 'WORKING_DAY'],
    ['holiday before rotation', null, { _id: 'holiday-1', isWorkDay: false }, true, 'HOLIDAY'],
    ['substitute workday before rotation', null, { _id: 'holiday-1', isWorkDay: true }, true, 'WORKING_DAY'],
    ['rotation before shift workdays', null, null, true, 'REST_DAY'],
  ])('selects %s', async (_label, override, holiday, rotationOff, status) => {
    activeSchedule();
    scheduleRepository.findCalendarOverrides.mockResolvedValue(override ? [override] : []);
    calendarPolicyRepository.findApplicable.mockResolvedValue(holiday);
    calendarPolicyRepository.isRotationOff.mockResolvedValue(rotationOff);

    await expect(resolveWorkContext({ profileId: 'profile-1', workDateKey: '2026-07-17' }))
      .resolves.toMatchObject({ status });
  });

  test('preserves the selected holiday evidence in the canonical snapshot', async () => {
    activeSchedule();
    calendarPolicyRepository.findApplicable.mockResolvedValue({
      _id: 'holiday-1', dateKey: '2026-07-17', name: 'Team holiday',
      holidayType: 'PUBLIC_HOLIDAY', isWorkDay: false,
      appliedDepartmentIds: ['department-1'], appliedTeamIds: ['team-1'], note: 'Observed',
    });

    await expect(resolveWorkContext({ profileId: 'profile-1', workDateKey: '2026-07-17' }))
      .resolves.toMatchObject({
        holiday: {
          id: 'holiday-1', appliedDepartmentIds: ['department-1'],
          appliedTeamIds: ['team-1'], note: 'Observed',
        },
      });
  });

  test('returns the local location and overnight shift duration context', async () => {
    activeSchedule();

    await expect(resolveWorkContext(input)).resolves.toMatchObject({
      status: 'REST_DAY',
      isWorkingDay: false,
      workLocation: {
        id: 'location-1',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      shift: {
        id: 'shift-1',
        startTime: '22:00',
        endTime: '06:00',
        durationMinutes: 480,
        isOvernight: true,
      },
      calendarOverride: null,
    });
    expect(scheduleRepository.findCalendarOverrides).toHaveBeenCalledWith('2026-07-18', {
      profileId: 'profile-1',
      workLocationId: 'location-1',
      departmentId: 'department-1',
      teamId: 'team-1',
    });
  });

  test('reuses static profile, shift, and location reads within one calendar request', async () => {
    activeSchedule();
    const cache = new Map();

    await Promise.all([
      resolveWorkContext({ profileId: 'profile-1', workDateKey: '2026-07-17' }, { cache }),
      resolveWorkContext({ profileId: 'profile-1', workDateKey: '2026-07-18' }, { cache }),
    ]);

    expect(profileRepository.findById).toHaveBeenCalledTimes(1);
    expect(scheduleRepository.findShiftById).toHaveBeenCalledTimes(1);
    expect(scheduleRepository.findWorkLocationById).toHaveBeenCalledTimes(1);
  });

  test('resolves a personal month from one batch per schedule data source', async () => {
    profileRepository.findById.mockResolvedValue({
      id: 'profile-1', status: 'ACTIVE', isDeleted: false, departmentId: 'department-1', teamId: 'team-1',
    });
    scheduleRepository.listAssignmentsEffectiveForProfiles.mockResolvedValue([{
      id: 'assignment-1', profileId: 'profile-1', shiftId: 'shift-1', workLocationId: 'location-1',
      status: 'ACTIVE', effectiveFrom: '2026-07-01', effectiveTo: null,
    }]);
    scheduleRepository.findShiftsByIds.mockResolvedValue([{
      id: 'shift-1', code: 'DAY', name: 'Day Shift', startTime: '08:00', endTime: '17:00',
      workdays: [1, 2, 3, 4, 5], status: 'ACTIVE',
    }]);
    scheduleRepository.findWorkLocationsByIds.mockResolvedValue([{
      id: 'location-1', code: 'HCM', name: 'Ho Chi Minh', timezone: 'Asia/Ho_Chi_Minh', status: 'ACTIVE',
    }]);
    scheduleRepository.findCalendarOverridesForDates.mockResolvedValue([
      { dateKey: '2026-07-03', scopeType: 'TEAM', scopeId: 'team-1', kind: 'WORKING_DAY', name: 'Team make-up day' },
    ]);
    calendarPolicyRepository.listHolidayRange.mockResolvedValue([
      { id: 'holiday-1', dateKey: '2026-07-02', isWorkDay: false, isActive: true },
    ]);
    calendarPolicyRepository.listRotationsForProfileDates.mockResolvedValue([
      { workDateKey: '2026-07-01', employeeProfileIds: ['profile-1'] },
    ]);

    const schedule = await resolveWorkContexts({
      profileId: 'profile-1',
      workDateKeys: ['2026-07-01', '2026-07-02', '2026-07-03'],
    });

    expect(schedule.map((item) => item.status)).toEqual(['REST_DAY', 'HOLIDAY', 'WORKING_DAY']);
    expect(schedule[1].holiday).toMatchObject({ id: 'holiday-1' });
    expect(schedule[2].calendarOverride).toMatchObject({ kind: 'WORKING_DAY' });
    expect(scheduleRepository.listAssignmentsEffectiveForProfiles).toHaveBeenCalledTimes(1);
    expect(scheduleRepository.findShiftsByIds).toHaveBeenCalledTimes(1);
    expect(scheduleRepository.findWorkLocationsByIds).toHaveBeenCalledTimes(1);
    expect(scheduleRepository.findCalendarOverridesForDates).toHaveBeenCalledTimes(1);
    expect(calendarPolicyRepository.listHolidayRange).toHaveBeenCalledTimes(1);
    expect(calendarPolicyRepository.listRotationsForProfileDates).toHaveBeenCalledTimes(1);
    expect(scheduleRepository.findEffectiveAssignment).not.toHaveBeenCalled();
  });

  test.each([
    ['profile is missing', () => profileRepository.findById.mockResolvedValue(null)],
    ['profile is inactive', () => profileRepository.findById.mockResolvedValue({ id: 'profile-1', status: 'SUSPENDED', isDeleted: false })],
    ['assignment is inactive', () => scheduleRepository.findEffectiveAssignment.mockResolvedValue({ id: 'assignment-1', status: 'SUSPENDED' })],
    ['shift is missing', () => scheduleRepository.findShiftById.mockResolvedValue(null)],
    ['shift is inactive', () => scheduleRepository.findShiftById.mockResolvedValue({ id: 'shift-1', status: 'SUSPENDED' })],
    ['work location is missing', () => scheduleRepository.findWorkLocationById.mockResolvedValue(null)],
    ['work location is inactive', () => scheduleRepository.findWorkLocationById.mockResolvedValue({ id: 'location-1', timezone: 'Asia/Ho_Chi_Minh', status: 'SUSPENDED' })],
    ['work location timezone is missing', () => scheduleRepository.findWorkLocationById.mockResolvedValue({ id: 'location-1', status: 'ACTIVE' })],
    ['work location timezone is invalid', () => scheduleRepository.findWorkLocationById.mockResolvedValue({ id: 'location-1', timezone: 'Not/A_Timezone', status: 'ACTIVE' })],
    ['shift duration is invalid', () => scheduleRepository.findShiftById.mockResolvedValue({
      id: 'shift-1',
      startTime: '06:00',
      endTime: '05:00',
      workdays: [1, 2, 3, 4, 5],
      status: 'ACTIVE',
    })],
  ])('returns SCHEDULE_UNRESOLVED when %s', async (_name, arrange) => {
    activeSchedule();
    arrange();

    await expect(resolveWorkContext(input)).resolves.toEqual({
      status: 'SCHEDULE_UNRESOLVED',
      profileId: 'profile-1',
      workDateKey: '2026-07-18',
    });
    expect(scheduleRepository.findCalendarOverrides).not.toHaveBeenCalled();
  });

  test('returns SCHEDULE_UNRESOLVED when the shift belongs to a different work location', async () => {
    activeSchedule();
    scheduleRepository.findShiftById.mockResolvedValue({
      id: 'shift-1',
      workLocationId: 'other-location-1',
      startTime: '22:00',
      endTime: '06:00',
      workdays: [1, 2, 3, 4, 5],
      status: 'ACTIVE',
    });

    await expect(resolveWorkContext(input)).resolves.toEqual({
      status: 'SCHEDULE_UNRESOLVED',
      profileId: 'profile-1',
      workDateKey: '2026-07-18',
    });
    expect(scheduleRepository.findCalendarOverrides).not.toHaveBeenCalled();
  });
});
