jest.mock('../../../modules/hr/repositories/calendarPolicy.repository', () => ({
  findApplicable: jest.fn(),
  isRotationOff: jest.fn(),
  upsertRotation: jest.fn(),
}));

jest.mock('../../../modules/hr/services/scheduleResolver.service', () => ({
  resolveWorkContext: jest.fn(),
}));

jest.mock('../../../modules/organization/public', () => ({
  listTeamMembers: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: (authContext, permission, scope) => (
    (authContext.permissions || []).includes(permission)
    || (authContext.scopes || []).some((candidate) => (
      candidate.scopeType === scope.scopeType
      && String(candidate.scopeId) === String(scope.scopeId)
      && (candidate.permissions || []).includes(permission)
    ))
  ),
}));

const repository = require('../../../modules/hr/repositories/calendarPolicy.repository');
const scheduleResolver = require('../../../modules/hr/services/scheduleResolver.service');
const organizationPublic = require('../../../modules/organization/public');
const service = require('../../../modules/hr/services/calendarPolicy.service');

describe('calendar policy service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findApplicable.mockResolvedValue(null);
    repository.isRotationOff.mockResolvedValue(false);
    scheduleResolver.resolveWorkContext.mockResolvedValue({
      status: 'REST_DAY',
      profileId: 'p1',
      workDateKey: '2026-09-06',
      profile: { departmentId: 'd1', teamId: 't1' },
      shift: { id: 's1', code: 'DAY', workdays: [1, 2, 3, 4, 5] },
      workLocation: { id: 'w1', timezone: 'Asia/Ho_Chi_Minh' },
      __v: 7,
    });
  });

  test('paid applicable holiday wins over Sunday and rotation-off', async () => {
    repository.findApplicable.mockResolvedValue({
      _id: 'h1',
      dateKey: '2026-09-06',
      name: 'National Day observed',
      holidayType: 'PUBLIC_HOLIDAY',
      isWorkDay: false,
      appliedDepartmentIds: [],
      appliedTeamIds: [],
      __v: 3,
    });
    repository.isRotationOff.mockResolvedValue(true);

    await expect(service.resolveCalendarPolicy({ profileId: 'p1', workDateKey: '2026-09-06' }))
      .resolves.toEqual({
        isSunday: true,
        isRotationOff: true,
        holiday: {
          id: 'h1',
          dateKey: '2026-09-06',
          name: 'National Day observed',
          holidayType: 'PUBLIC_HOLIDAY',
          isPaid: true,
          isWorkDay: false,
          appliedDepartmentIds: [],
          appliedTeamIds: [],
          note: null,
        },
        scheduleSnapshot: {
          status: 'REST_DAY',
          profileId: 'p1',
          workDateKey: '2026-09-06',
          profile: { departmentId: 'd1', teamId: 't1' },
          shift: { id: 's1', code: 'DAY', workdays: [1, 2, 3, 4, 5] },
          workLocation: { id: 'w1', timezone: 'Asia/Ho_Chi_Minh' },
          assignment: null,
          calendarOverride: null,
          isWorkingDay: false,
        },
      });
  });

  test('returns a substitute work day without hiding Sunday or rotation state', async () => {
    repository.findApplicable.mockResolvedValue({
      id: 'h2',
      dateKey: '2026-09-12',
      name: 'Company closure',
      holidayType: 'SUBSTITUTE_WORK_DAY',
      isWorkDay: true,
      appliedDepartmentIds: [],
      appliedTeamIds: ['t1'],
    });
    repository.isRotationOff.mockResolvedValue(true);
    scheduleResolver.resolveWorkContext.mockResolvedValue({
      status: 'REST_DAY', profileId: 'p1', workDateKey: '2026-09-12', isWorkingDay: false,
    });

    await expect(service.resolveCalendarPolicy({ profileId: 'p1', workDateKey: '2026-09-12' }))
      .resolves.toMatchObject({
        isSunday: false,
        isRotationOff: true,
        holiday: { id: 'h2', isPaid: false, isWorkDay: true },
        scheduleSnapshot: { status: 'REST_DAY' },
      });
  });

  test('generates every Saturday with round-robin off profiles within capacity', async () => {
    organizationPublic.listTeamMembers.mockResolvedValue({
      team: { id: 't1' },
      leaders: [{ profileId: 'p1' }],
      members: [{ profileId: 'p2' }, { profileId: 'p3' }],
    });
    const persisted = [];
    repository.upsertRotation.mockImplementation(async (rotation) => {
      const result = { id: `r${persisted.length + 1}`, ...rotation };
      persisted.push(result);
      return result;
    });

    await expect(service.generateRotations({ teamId: 't1', month: 2, year: 2026, minPresent: 2 }))
      .resolves.toMatchObject({
        generated: 4,
        items: [
          { dateKey: '2026-02-07', employeeProfileIds: ['p1'] },
          { dateKey: '2026-02-14', employeeProfileIds: ['p2'] },
          { dateKey: '2026-02-21', employeeProfileIds: ['p3'] },
          { dateKey: '2026-02-28', employeeProfileIds: ['p1'] },
        ],
      });
  });

  test('rejects a custom rotation containing a profile outside the active team', async () => {
    organizationPublic.listTeamMembers.mockResolvedValue({
      team: { id: 't1' }, leaders: [], members: [{ profileId: 'p1' }, { profileId: 'p2' }],
    });

    await expect(service.generateRotations({
      teamId: 't1',
      month: 2,
      year: 2026,
      minPresent: 1,
      customRotations: [{ dateKey: '2026-02-07', employeeProfileIds: ['outside'] }],
    })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  test('rejects rotation generation outside the granted team scope', async () => {
    await expect(service.generateRotations(
      { teamId: 't1', month: 2, year: 2026 },
      { scopes: [{ scopeType: 'team', scopeId: 't2', permissions: ['HR_SCHEDULE:WRITE'] }] },
    )).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });
});

describe('calendar policy persistence', () => {
  test('keeps one holiday globally per date and one team rotation per Saturday', () => {
    const Holiday = require('../../../modules/hr/models/holiday.model');
    const SaturdayRotation = require('../../../modules/hr/models/saturdayRotation.model');

    expect(Holiday.schema.indexes()).toContainEqual([
      { dateKey: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(SaturdayRotation.schema.indexes()).toContainEqual([
      { teamId: 1, workDateKey: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  test('derives rotation month and year from a valid Saturday date', async () => {
    const SaturdayRotation = require('../../../modules/hr/models/saturdayRotation.model');
    const rotation = new SaturdayRotation({
      teamId: '507f1f77bcf86cd799439012',
      workDateKey: '2026-02-07',
      employeeProfileIds: [],
      minPresent: 1,
    });

    await rotation.validate();

    expect({ month: rotation.month, year: rotation.year }).toEqual({ month: 2, year: 2026 });
  });
});
