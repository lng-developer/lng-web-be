jest.mock('../../../modules/hr/repositories/calendarPolicy.repository', () => ({
  createHoliday: jest.fn(),
  findApplicable: jest.fn(),
  findHolidayById: jest.fn(),
  isRotationOff: jest.fn(),
  updateHoliday: jest.fn(),
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
      status: 'REST_DAY',
      profileId: 'p1',
      workDateKey: '2026-09-12',
      profile: { departmentId: 'd1', teamId: 't1' },
      isWorkingDay: false,
    });

    await expect(service.resolveCalendarPolicy({ profileId: 'p1', workDateKey: '2026-09-12' }))
      .resolves.toMatchObject({
        isSunday: false,
        isRotationOff: true,
        holiday: { id: 'h2', isPaid: false, isWorkDay: true },
        scheduleSnapshot: { status: 'REST_DAY' },
      });
  });

  test('ignores an old-team rotation after the profile moves teams', async () => {
    scheduleResolver.resolveWorkContext.mockResolvedValue({
      status: 'WORKING_DAY',
      profileId: 'p1',
      workDateKey: '2026-09-12',
      profile: { departmentId: 'd1', teamId: 'team-new' },
      isWorkingDay: true,
    });
    repository.isRotationOff.mockImplementation(async (_profileId, _dateKey, teamId) => (
      teamId ? teamId === 'team-old' : true
    ));

    await expect(service.resolveCalendarPolicy({ profileId: 'p1', workDateKey: '2026-09-12' }))
      .resolves.toMatchObject({ isRotationOff: false });
  });

  test('rejects creating a second holiday on the same date', async () => {
    repository.createHoliday.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));

    await expect(service.createHoliday({ name: 'Duplicate', dateKey: '2026-09-02' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
  });

  test('bulk import skips existing dates without overwriting them', async () => {
    repository.createHoliday
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }))
      .mockResolvedValueOnce({
        id: 'h2', name: 'New holiday', dateKey: '2026-09-03', holidayType: 'PUBLIC_HOLIDAY', isWorkDay: false,
      });

    await expect(service.bulkImportHolidays({ items: [
      { name: 'Existing holiday', dateKey: '2026-09-02' },
      { name: 'New holiday', dateKey: '2026-09-03' },
    ] })).resolves.toMatchObject({
      imported: 1,
      skipped: 1,
      items: [{ id: 'h2', dateKey: '2026-09-03' }],
      duplicates: [{ dateKey: '2026-09-02', reason: 'HOLIDAY_DATE_EXISTS' }],
    });
  });

  test('patch date takes precedence over the stored date key', async () => {
    repository.findHolidayById.mockResolvedValue({
      id: 'h1',
      name: 'Holiday',
      dateKey: '2026-09-02',
      holidayType: 'PUBLIC_HOLIDAY',
      isWorkDay: false,
      appliedDepartmentIds: [],
      appliedTeamIds: [],
      isActive: true,
    });
    repository.updateHoliday.mockImplementation(async (id, patch) => ({ id, ...patch }));

    await expect(service.updateHoliday('h1', { date: '2026-09-03T00:00:00.000Z' }))
      .resolves.toMatchObject({ id: 'h1', dateKey: '2026-09-03' });
  });

  test('returns the six named legacy holiday templates', () => {
    const year = new Date().getFullYear();
    expect(service.listHolidayTemplates()).toEqual({ items: [
      {
        key: 'lunar-new-year', name: 'Tết Nguyên Đán', description: 'Tết Nguyên Đán (Tết dương lịch)',
        holiday: { name: 'Tết Nguyên Đán', isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Tết dương lịch - 3 ngày nghỉ' },
      },
      {
        key: 'lunar-new-year-ext', name: 'Tết Nguyên Đán (Mở rộng)', description: 'Tết Nguyên Đán + ngày thay (nếu có)',
        holiday: { name: 'Tết Nguyên Đán (Ngày thay)', isWorkDay: true, holidayType: 'SUBSTITUTE_WORK_DAY', note: 'Ngày thay cho Tết' },
      },
      {
        key: 'reunification-day', name: 'Ngày Quốc khánh (30/4)', description: 'Ngày Quốc khánh',
        holiday: { name: 'Ngày Quốc khánh', dateKey: `${year}-04-30`, isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Ngày Quốc khánh 30/4' },
      },
      {
        key: 'international-labor-day', name: 'Ngày Quốc tế Lao động (1/5)', description: 'Ngày Quốc tế Lao động',
        holiday: { name: 'Ngày Quốc tế Lao động', dateKey: `${year}-05-01`, isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Ngày Quốc tế Lao động 1/5' },
      },
      {
        key: 'national-day', name: 'Ngày Quốc khánh (2/9)', description: 'Ngày Quốc khánh Việt Nam',
        holiday: { name: 'Ngày Quốc khánh', dateKey: `${year}-09-02`, isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Ngày Quốc khánh 2/9' },
      },
      {
        key: 'mid-autumn', name: 'Tết Trung Thu', description: 'Tết Trung Thu (mùng 15 tháng 8 âm lịch)',
        holiday: { name: 'Tết Trung Thu', isWorkDay: false, holidayType: 'PUBLIC_HOLIDAY', note: 'Tết Trung Thu' },
      },
    ] });
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

  test('defaults minPresent to half the active team rounded up', async () => {
    organizationPublic.listTeamMembers.mockResolvedValue({
      team: { id: 't1' }, leaders: [{ profileId: 'p1' }], members: [{ profileId: 'p2' }, { profileId: 'p3' }],
    });
    repository.upsertRotation.mockImplementation(async (rotation) => ({ id: rotation.workDateKey, ...rotation }));

    const result = await service.generateRotations({ teamId: 't1', month: 2, year: 2026 });

    expect(result.items).toHaveLength(4);
    expect(result.items.every((item) => item.minPresent === 2 && item.employeeProfileIds.length === 1)).toBe(true);
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
      { scopes: [{ scopeType: 'team', scopeId: 't2', permissions: ['HR_CALENDAR:WRITE'] }] },
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
