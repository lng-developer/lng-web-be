jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn((auth, permission) => (auth.permissions || []).includes(permission)),
  getCurrentAccount: jest.fn(),
}));
jest.mock('../../../modules/organization/public', () => ({
  listAccountOrganizationSummaries: jest.fn(),
  listDepartmentsByIds: jest.fn(),
  listTeamsByIds: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listByIds: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/attendance.repository', () => ({ list: jest.fn() }));
jest.mock('../../../modules/hr/repositories/schedule.repository', () => ({
  findShiftsByIds: jest.fn(),
  findWorkLocationsByIds: jest.fn(),
  listAssignments: jest.fn(),
  listCalendarOverrides: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const organizationPublic = require('../../../modules/organization/public');
const profileRepository = require('../../../modules/hr/repositories/employeeProfile.repository');
const attendanceRepository = require('../../../modules/hr/repositories/attendance.repository');
const scheduleRepository = require('../../../modules/hr/repositories/schedule.repository');
const attendanceService = require('../../../modules/hr/services/attendance.service');
const profileService = require('../../../modules/hr/services/employeeProfile.service');
const scheduleService = require('../../../modules/hr/services/schedule.service');

const ids = {
  account: '660000000000000000000001',
  profile: '660000000000000000000002',
  shift: '660000000000000000000003',
  location: '660000000000000000000004',
};
const employee = { _id: ids.profile, accountId: ids.account, employeeCode: 'EMP001', fullName: 'Test Employee' };
const page = { pagination: { page: 1, limit: 20, total: 1 } };

describe('operator response services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.getCurrentAccount.mockResolvedValue(null);
    profileRepository.findByAccountId.mockResolvedValue(employee);
    profileRepository.findById.mockResolvedValue(employee);
    profileRepository.listByIds.mockResolvedValue([employee]);
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId: ids.account,
      department: { id: '660000000000000000000005', code: 'OPS', name: 'Operations' },
      team: { id: '660000000000000000000006', code: 'OPS-A', name: 'Operations A' },
    }]);
    organizationPublic.listDepartmentsByIds.mockResolvedValue([]);
    organizationPublic.listTeamsByIds.mockResolvedValue([]);
  });

  test('batches attendance profile summaries and exposes the same adjustment authority', async () => {
    attendanceRepository.list.mockResolvedValue({ ...page, items: [{
      _id: '660000000000000000000010', profileId: ids.profile,
      scheduleSnapshot: {
        shift: { id: ids.shift, code: 'DAY', name: 'Day shift' },
        workLocation: { id: ids.location, code: 'HCM', name: 'HCM Office' },
      },
    }] });

    await expect(attendanceService.listAttendance({}, {
      accountId: ids.account,
      permissions: ['HR_ATTENDANCE:READ', 'HR_ATTENDANCE:MANAGE'],
    })).resolves.toMatchObject({
      items: [{
        employee: { id: ids.profile, employeeCode: 'EMP001', fullName: 'Test Employee' },
        capabilities: { view: true, adjust: true },
      }],
    });
    expect(profileRepository.listByIds).toHaveBeenCalledWith([ids.profile]);
  });

  test('batches assignment and profile override summaries without per-row lookups', async () => {
    scheduleRepository.listAssignments.mockResolvedValue({ ...page, items: [{
      _id: '660000000000000000000011', profileId: ids.profile, shiftId: ids.shift, workLocationId: ids.location,
    }] });
    scheduleRepository.findShiftsByIds.mockResolvedValue([{ _id: ids.shift, code: 'DAY', name: 'Day shift' }]);
    scheduleRepository.findWorkLocationsByIds.mockResolvedValue([{ _id: ids.location, code: 'HCM', name: 'HCM Office' }]);
    scheduleRepository.listCalendarOverrides.mockResolvedValue({ ...page, items: [{
      _id: '660000000000000000000012', scopeType: 'PROFILE', scopeId: ids.profile,
    }] });
    const auth = { permissions: ['HR_SCHEDULE:READ', 'HR_SCHEDULE:WRITE'] };

    await expect(scheduleService.listAssignments({}, auth)).resolves.toMatchObject({
      items: [{ employee: { fullName: 'Test Employee' }, shift: { name: 'Day shift' }, capabilities: { edit: true } }],
    });
    await expect(scheduleService.listCalendarOverrides({}, auth)).resolves.toMatchObject({
      items: [{ scopeTarget: { fullName: 'Test Employee' }, capabilities: { edit: true } }],
    });
    expect(profileRepository.listByIds).toHaveBeenCalledTimes(2);
    expect(scheduleRepository.findShiftsByIds).toHaveBeenCalledWith([ids.shift]);
    expect(scheduleRepository.findWorkLocationsByIds).toHaveBeenCalledWith([ids.location]);
  });

  test('batches existing organization summaries for profile list and detail responses', async () => {
    profileRepository.list.mockResolvedValue({ ...page, items: [employee] });
    const auth = { permissions: ['HR_EMPLOYEES:READ'] };

    await expect(profileService.listProfiles({}, auth)).resolves.toMatchObject({
      items: [{ department: { name: 'Operations' }, team: { name: 'Operations A' } }],
    });
    await expect(profileService.getProfile(ids.profile, auth)).resolves.toMatchObject({
      department: { name: 'Operations' }, team: { name: 'Operations A' },
    });
    expect(organizationPublic.listAccountOrganizationSummaries).toHaveBeenLastCalledWith([ids.account]);
  });
});
