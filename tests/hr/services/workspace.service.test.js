jest.mock('../../../src/modules/hr/repositories/employeeProfile.repository', () => ({ findByAccountId: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/attendance.repository', () => ({ findByProfileAndWorkDate: jest.fn(), list: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/leave.repository', () => ({ listBalances: jest.fn(), listRequests: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/overtime.repository', () => ({ listRequests: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/payroll.repository', () => ({ listResultsForAccount: jest.fn() }));
jest.mock('../../../src/modules/hr/repositories/announcement.repository', () => ({ list: jest.fn() }));
jest.mock('../../../src/modules/hr/services/scheduleResolver.service', () => ({ resolveWorkContext: jest.fn() }));

const profileRepository = require('../../../src/modules/hr/repositories/employeeProfile.repository');
const attendanceRepository = require('../../../src/modules/hr/repositories/attendance.repository');
const leaveRepository = require('../../../src/modules/hr/repositories/leave.repository');
const overtimeRepository = require('../../../src/modules/hr/repositories/overtime.repository');
const payrollRepository = require('../../../src/modules/hr/repositories/payroll.repository');
const announcementRepository = require('../../../src/modules/hr/repositories/announcement.repository');
const scheduleResolver = require('../../../src/modules/hr/services/scheduleResolver.service');
const service = require('../../../src/modules/hr/services/workspace.service');

describe('HR personal workspace', () => {
  test('aggregates only the authenticated employee data and important alerts', async () => {
    const profile = { _id: 'profile-1', accountId: 'account-1', fullName: 'Staff', employeeCode: 'J001', departmentId: 'dep-1', teamId: 'team-1' };
    profileRepository.findByAccountId.mockResolvedValue(profile);
    scheduleResolver.resolveWorkContext.mockImplementation(({ workDateKey }) => Promise.resolve({ workDateKey, isWorkingDay: true, shift: { name: 'Day' } }));
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
    expect(result.calendar.find((day) => day.workDateKey === '2026-07-02')).toMatchObject({
      attendance: { status: 'LATE', lateMinutes: 12 },
      overtime: [{ requestedMinutes: 90, status: 'APPROVED' }],
    });
    expect(result.calendar.find((day) => day.workDateKey === '2026-07-03')).toMatchObject({
      leave: [{ leaveType: 'ANNUAL', status: 'APPROVED' }],
    });
  });
});
