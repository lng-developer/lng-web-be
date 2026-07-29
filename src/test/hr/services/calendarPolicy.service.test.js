const crypto = require('crypto');

jest.mock('../../../modules/hr/repositories/calendarPolicy.repository', () => ({
  createHoliday: jest.fn(),
  deleteRotation: jest.fn(),
  deleteTeamRotations: jest.fn(),
  findApplicable: jest.fn(),
  findHolidayById: jest.fn(),
  findRotationById: jest.fn(),
  isRotationOff: jest.fn(),
  listRotations: jest.fn(),
  listRotationsForMatrix: jest.fn(),
  softDeleteHoliday: jest.fn(),
  updateHoliday: jest.fn(),
  updateRotation: jest.fn(),
  upsertRotation: jest.fn(),
}));

jest.mock('../../../modules/hr/services/scheduleResolver.service', () => ({
  resolveWorkContext: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  listIds: jest.fn(),
}));

jest.mock('../../../modules/organization/public', () => ({
  getDepartmentById: jest.fn(),
  getTeamById: jest.fn(),
  listTeamMembers: jest.fn(),
}));
jest.mock('../../../modules/audit/public', () => ({
  record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
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
const profileRepository = require('../../../modules/hr/repositories/employeeProfile.repository');
const auditPublic = require('../../../modules/audit/public');
const scheduleResolver = require('../../../modules/hr/services/scheduleResolver.service');
const organizationPublic = require('../../../modules/organization/public');
const service = require('../../../modules/hr/services/calendarPolicy.service');

describe('calendar policy service', () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findApplicable.mockResolvedValue(null);
    repository.isRotationOff.mockResolvedValue(false);
    profileRepository.listIds.mockResolvedValue([{ _id: 'p1' }, { _id: 'p2' }, { _id: 'p3' }]);
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

  test('audits holiday and rotation mutations without names, notes, or employee lists', async () => {
    const auth = {
      accountId: '660000000000000000000001',
      permissions: ['HR_CALENDAR:WRITE'],
    };
    const holidayId = '660000000000000000000010';
    const rotationId = '660000000000000000000020';
    const updatedAt = new Date('2026-07-29T03:00:00.000Z');
    const holiday = {
      _id: holidayId,
      name: 'Private company event',
      note: 'Sensitive note',
      dateKey: '2026-09-02',
      holidayType: 'PUBLIC_HOLIDAY',
      isWorkDay: false,
      appliedDepartmentIds: [],
      appliedTeamIds: [],
      isActive: true,
      updatedAt,
    };
    const rotation = {
      _id: rotationId,
      teamId: '660000000000000000000030',
      workDateKey: '2026-02-07',
      month: 2,
      year: 2026,
      employeeProfileIds: ['660000000000000000000040'],
      minPresent: 1,
      updatedAt,
    };
    repository.createHoliday.mockResolvedValue(holiday);
    repository.findHolidayById.mockResolvedValue(holiday);
    repository.updateHoliday.mockResolvedValue(holiday);
    repository.softDeleteHoliday.mockResolvedValue({ ...holiday, isActive: false });
    organizationPublic.listTeamMembers.mockResolvedValue({
      leaders: [], members: [{ profileId: '660000000000000000000040' }],
    });
    repository.upsertRotation.mockResolvedValue(rotation);
    repository.findRotationById.mockResolvedValue(rotation);
    repository.updateRotation.mockResolvedValue(rotation);
    repository.deleteRotation.mockResolvedValue(rotation);
    repository.listRotations.mockResolvedValue({ items: [rotation], pagination: { total: 1 } });
    repository.deleteTeamRotations.mockResolvedValue({ deletedCount: 1 });

    await service.createHoliday(holiday, auth);
    await service.updateHoliday(holidayId, { isWorkDay: true }, auth);
    await service.deleteHoliday(holidayId, auth);
    await service.bulkImportHolidays({ items: [{ ...holiday, dateKey: '2026-09-03' }] }, auth);
    await service.generateRotations({
      teamId: rotation.teamId, month: 2, year: 2026, minPresent: 1,
    }, auth);
    await service.updateRotation(rotationId, { employeeProfileIds: [] }, auth);
    await service.deleteRotation(rotationId, auth);
    await service.deleteTeamRotations(rotation.teamId, { month: 2, year: 2026 }, auth);

    const actions = auditPublic.record.mock.calls.map(([event]) => event.action);
    expect(actions).toEqual(expect.arrayContaining([
      'HR_HOLIDAY_CREATED',
      'HR_HOLIDAY_UPDATED',
      'HR_HOLIDAY_DELETED',
      'HR_HOLIDAY_IMPORTED',
      'HR_SATURDAY_ROTATION_GENERATED',
      'HR_SATURDAY_ROTATION_UPDATED',
      'HR_SATURDAY_ROTATION_DELETED',
      'HR_SATURDAY_ROTATIONS_DELETED',
    ]));
    expect(actions.filter((action) => action === 'HR_SATURDAY_ROTATION_GENERATED')).toHaveLength(4);
    expect(JSON.stringify(auditPublic.record.mock.calls)).not.toMatch(/Private company event|Sensitive note|660000000000000000000040/);
  });

  test('gives same-timestamp holiday updates distinct server mutation identities', async () => {
    const auth = { accountId: '660000000000000000000001', permissions: ['HR_CALENDAR:WRITE'] };
    const holiday = {
      _id: '660000000000000000000010',
      dateKey: '2026-09-02',
      holidayType: 'PUBLIC_HOLIDAY',
      isWorkDay: false,
      appliedDepartmentIds: [],
      appliedTeamIds: [],
      isActive: true,
      updatedAt: new Date('2026-07-29T03:00:00.000Z'),
    };
    jest.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000031')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000032');
    repository.findHolidayById.mockResolvedValue(holiday);
    repository.updateHoliday.mockResolvedValue(holiday);

    await service.updateHoliday(String(holiday._id), { isWorkDay: true }, auth);
    await service.updateHoliday(String(holiday._id), { isWorkDay: false }, auth);

    expect(auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey)).toEqual([
      `hr:hr_holiday_updated:${holiday._id}:00000000-0000-4000-8000-000000000031`,
      `hr:hr_holiday_updated:${holiday._id}:00000000-0000-4000-8000-000000000032`,
    ]);
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

  test('creates one manual Saturday rotation and exposes its source', async () => {
    organizationPublic.listTeamMembers.mockResolvedValue({
      team: { id: 't1' }, leaders: [], members: [{ profileId: 'p1' }, { profileId: 'p2' }],
    });
    repository.upsertRotation.mockImplementation(async (rotation) => ({ id: 'r1', ...rotation }));

    await expect(service.createRotation({
      teamId: 't1', dateKey: '2026-02-07', employeeProfileIds: ['p1'], minPresent: 1,
    })).resolves.toMatchObject({
      id: 'r1', dateKey: '2026-02-07', employeeProfileIds: ['p1'], minPresent: 1, source: 'MANUAL',
    });
  });

  test('updates a rotation from active HR profiles even when organization members have no profile id', async () => {
    repository.findRotationById.mockResolvedValue({
      _id: 'r1', teamId: 't1', workDateKey: '2026-02-07', minPresent: 1,
    });
    repository.updateRotation.mockImplementation(async (_id, patch) => ({
      _id: 'r1', teamId: 't1', workDateKey: '2026-02-07', minPresent: 1, ...patch,
    }));
    organizationPublic.listTeamMembers.mockResolvedValue({
      team: { id: 't1', name: 'Operations' }, leaders: [], members: [{ profileId: null }],
    });
    profileRepository.listIds.mockResolvedValue([{ _id: 'p1' }, { _id: 'p2' }]);

    await expect(service.updateRotation('r1', { employeeProfileIds: ['p1'] }))
      .resolves.toMatchObject({ id: 'r1', employeeProfileIds: ['p1'], source: 'MANUAL' });
    expect(profileRepository.listIds).toHaveBeenCalledWith({ teamId: 't1', status: 'ACTIVE' });
  });

  test('keeps manually edited Saturdays when generating the month again', async () => {
    organizationPublic.listTeamMembers.mockResolvedValue({
      team: { id: 't1' }, leaders: [], members: [{ profileId: 'p1' }, { profileId: 'p2' }, { profileId: 'p3' }],
    });
    repository.listRotations.mockResolvedValue({
      items: [{
        id: 'manual-1', teamId: 't1', workDateKey: '2026-02-07', month: 2, year: 2026,
        employeeProfileIds: ['p3'], minPresent: 2, source: 'MANUAL',
      }],
      pagination: { page: 1, limit: 100, total: 1 },
    });
    repository.upsertRotation.mockImplementation(async (rotation) => ({ id: rotation.workDateKey, ...rotation }));

    const result = await service.generateRotations({ teamId: 't1', month: 2, year: 2026, minPresent: 2 });

    expect(result.items.find((item) => item.dateKey === '2026-02-07')).toMatchObject({
      id: 'manual-1', employeeProfileIds: ['p3'], source: 'MANUAL',
    });
    expect(repository.upsertRotation).not.toHaveBeenCalledWith(expect.objectContaining({ workDateKey: '2026-02-07' }));
  });

  test('returns team coverage and each Saturday for the rotation matrix', async () => {
    repository.listRotationsForMatrix.mockResolvedValue([{
      id: 'r1', teamId: 't1', workDateKey: '2026-02-07', month: 2, year: 2026,
      employeeProfileIds: ['p1'], minPresent: 2, source: 'MANUAL',
    }]);
    organizationPublic.listTeamMembers.mockResolvedValue({
      team: { id: 't1', name: 'Operations' },
      leaders: [{ profileId: 'p1' }],
      members: [{ profileId: 'p2' }, { profileId: 'p3' }],
    });

    await expect(service.listRotationMatrix({ month: 2, year: 2026 }))
      .resolves.toMatchObject({
        dates: ['2026-02-07', '2026-02-14', '2026-02-21', '2026-02-28'],
        teams: [{
          id: 't1', name: 'Operations', memberCount: 3,
          cells: expect.arrayContaining([
            { dateKey: '2026-02-07', rotationId: 'r1', employeeProfileIds: ['p1'], offCount: 1, presentCount: 2, minPresent: 2, source: 'MANUAL' },
            { dateKey: '2026-02-14', rotationId: null, employeeProfileIds: [], offCount: 0, presentCount: 3, minPresent: null, source: null },
          ]),
        }],
      });
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
