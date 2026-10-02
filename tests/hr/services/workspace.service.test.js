jest.mock('../../../src/modules/hr/repositories/employeeProfile.repository', () => ({ findByAccountId: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/attendance.repository', () => ({ findByProfileAndWorkDate: jest.fn(), list: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/leave.repository', () => ({ listBalances: jest.fn(), listRequests: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/overtime.repository', () => ({ listRequests: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/payroll.repository', () => ({ listResultsForAccount: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/announcement.repository', () => ({ list: jest.fn() }));
jest.mock('../../../src/modules/hr/services/scheduleResolver.service', () => ({ resolveWorkContext: jest.fn(), resolveWorkContexts: jest.fn() }));
jest.mock('../../../src/modules/hr/services/employeeProfile.service', () => ({ listProfiles: jest.fn() }));
jest.mock('../../../src/modules/hr/services/attendance.service', () => ({ listAttendance: jest.fn() }));
jest.mock('../../../src/modules/hr/services/leave.service', () => ({ listRequests: jest.fn() }));
jest.mock('../../../src/modules/hr/services/overtime.service', () => ({ listRequests: jest.fn() }));
jest.mock('../../../src/modules/hr/services/schedule.service', () => ({ listAssignments: jest.fn() }));

const profileRepository = require('../../../src/modules/hr/repositories/employeeProfile.repository');
const attendanceRepository = require('../../../src/modules/hr/repositories/attendance.repository');
const leaveRepository = require('../../../src/modules/hr/repositories/leave.repository');
const overtimeRepository = require('../../../src/modules/hr/repositories/overtime.repository');
const payrollRepository = require('../../../src/modules/hr/repositories/payroll.repository');
const announcementRepository = require('../../../src/modules/hr/repositories/announcement.repository');
const scheduleResolver = require('../../../src/modules/hr/services/scheduleResolver.service');
const profileService = require('../../../src/modules/hr/services/employeeProfile.service');
const attendanceService = require('../../../src/modules/hr/services/attendance.service');
const leaveService = require('../../../src/modules/hr/services/leave.service');
const overtimeService = require('../../../src/modules/hr/services/overtime.service');
const scheduleService = require('../../../src/modules/hr/services/schedule.service');
const service = require('../../../src/modules/hr/services/workspace.service');

describe('HR personal workspace', () => {
  test('aggregates only the authenticated employee data and important alerts', async () => {
    const profile = { _id: 'profile-1', accountId: 'account-1', fullName: 'Staff', employeeCode: 'J001', departmentId: 'dep-1', teamId: 'team-1' };
    profileRepository.findByAccountId.mockResolvedValue(profile);
    scheduleResolver.resolveWorkContexts.mockImplementation(({ workDateKeys }) => Promise.resolve(
      workDateKeys.map((workDateKey) => ({ workDateKey, isWorkingDay: true, shift: { name: 'Day' } })),
    ));
    attendanceRepository.findByProfileAndWorkDate.mockResolvedValue({ status: 'PRESENT' });
    attendanceRepository.list.mockResolvedValue({
      items: [{ workDateKey: '2026-07-02', status: 'LATE', checkInAt: '2026-07-02T01:12:00.000Z', checkOutAt: '2026-07-02T10:05:00.000Z', lateMinutes: 12 }],
      pagination: { total: 1 },
    });
    leaveRepository.listBalances.mockResolvedValue([{ availableUnits: 10 }]);
    leaveRepository.listRequests.mockResolvedValue({ items: [{ profileId: 'profile-1', startDateKey: '2026-07-03', endDateKey: '2026-07-04', leaveType: 'ANNUAL', status: 'APPROVED' }], pagination: { total: 1 } });
    overtimeRepository.listRequests.mockResolvedValue({ items: [{ profileId: 'profile-1', workDateKey: '2026-07-02', requestedMinutes: 90, status: 'APPROVED' }], pagination: { total: 1 } });
    payrollRepository.listResultsForAccount.mockResolvedValue({ items: [{ netIncome: 1000 }], pagination: { total: 1 } });
    announcementRepository.list.mockResolvedValue({ items: [{ title: 'Notice' }], pagination: { total: 1 } });

    const result = await service.getMyWorkspace({ dateKey: '2026-07-31', year: 2026, month: 7 }, { accountId: 'account-1' });

    expect(attendanceRepository.findByProfileAndWorkDate).toHaveBeenCalledWith('profile-1', '2026-07-31');
    expect(leaveRepository.listRequests).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'profile-1' }));
    expect(result).toMatchObject({ profile: { id: 'profile-1' }, today: { attendance: { status: 'PRESENT' } }, leave: { availableUnits: 10 }, latestPayroll: { netIncome: 1000 } });
    expect(result.schedule).toHaveLength(31);
    expect(scheduleResolver.resolveWorkContexts).toHaveBeenCalledWith({
      profileId: 'profile-1',
      workDateKeys: expect.arrayContaining(['2026-07-01', '2026-07-31']),
    });
    expect(result.calendar.find((day) => day.workDateKey === '2026-07-02')).toMatchObject({
      attendance: { status: 'LATE', lateMinutes: 12 },
      overtime: [{ requestedMinutes: 90, status: 'APPROVED' }],
    });
    expect(result.calendar.find((day) => day.workDateKey === '2026-07-03')).toMatchObject({
      leave: [{ leaveType: 'ANNUAL', status: 'APPROVED' }],
    });
  });
});

describe('HR team workspace scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const page = { items: [], pagination: { page: 1, limit: 100, total: 0 } };
    profileService.listProfiles.mockResolvedValue(page);
    attendanceService.listAttendance.mockResolvedValue(page);
    leaveService.listRequests.mockResolvedValue(page);
    overtimeService.listRequests.mockResolvedValue(page);
    scheduleService.listAssignments.mockResolvedValue(page);
  });

  const leaderScope = {
    scopeType: 'team',
    scopeId: 'team-sales',
    permissions: [
      'HR_EMPLOYEES:READ',
      'HR_SCHEDULE:READ',
      'HR_ATTENDANCE:READ',
      'HR_LEAVE:READ',
      'HR_OVERTIME:READ',
    ],
  };

  test('uses the sole allowed team when a scoped leader omits teamId', async () => {
    await service.getTeamWorkspace(
      { dateKey: '2026-10-02' },
      { permissions: [], scopes: [leaderScope] },
    );

    expect(profileService.listProfiles).toHaveBeenCalledWith(
      { teamId: 'team-sales', limit: 100 },
      expect.any(Object),
    );
    expect(attendanceService.listAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team-sales', dateFrom: '2026-10-02', dateTo: '2026-10-02' }),
      expect.any(Object),
    );
    expect(leaveService.listRequests).toHaveBeenCalledWith(
      { teamId: 'team-sales', limit: 100, status: 'PENDING' },
      expect.any(Object),
    );
    expect(overtimeService.listRequests).toHaveBeenCalledWith(
      { teamId: 'team-sales', limit: 100, status: 'PENDING' },
      expect.any(Object),
    );
    expect(scheduleService.listAssignments).toHaveBeenCalledWith(
      { teamId: 'team-sales', limit: 100 },
      expect.any(Object),
    );
  });

  test('returns profiles for a leader with calendar access to one team', async () => {
    await service.getTeamWorkspace(
      { dateKey: '2026-10-02' },
      {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: 'team-sales',
          permissions: ['HR_CALENDAR:READ', 'HR_CALENDAR:WRITE'],
        }],
      },
    );

    expect(profileService.listProfiles).toHaveBeenCalledWith(
      { teamId: 'team-sales', limit: 100 },
      expect.any(Object),
    );
  });

  test('rejects a team outside the leader scope before querying HR data', async () => {
    await expect(
      service.getTeamWorkspace(
        { dateKey: '2026-10-02', teamId: 'team-design' },
        { permissions: [], scopes: [leaderScope] },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(profileService.listProfiles).not.toHaveBeenCalled();
    expect(attendanceService.listAttendance).not.toHaveBeenCalled();
  });

  test('rejects a user without an eligible team HR read scope', async () => {
    await expect(
      service.getTeamWorkspace(
        { dateKey: '2026-10-02', teamId: 'team-sales' },
        { permissions: [], scopes: [{ ...leaderScope, permissions: ['TEAMS:READ'] }] },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('requires a selection when a scoped leader leads multiple teams', async () => {
    await expect(
      service.getTeamWorkspace(
        { dateKey: '2026-10-02' },
        { permissions: [], scopes: [leaderScope, { ...leaderScope, scopeId: 'team-design' }] },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('preserves global HR team queries', async () => {
    await service.getTeamWorkspace(
      { dateKey: '2026-10-02', teamId: 'team-design' },
      { permissions: ['HR_EMPLOYEES:READ'], scopes: [] },
    );

    expect(profileService.listProfiles).toHaveBeenCalledWith(
      { teamId: 'team-design', limit: 100 },
      expect.any(Object),
    );
  });
});
