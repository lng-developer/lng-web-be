const profileId = '660000000000000000000001';
const shiftId = '660000000000000000000002';
const locationId = '660000000000000000000003';

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn((authContext, permission, scope) => (authContext.permissions || []).includes(permission)
    || (authContext.scopes || []).some((granted) => granted.scopeType === scope.scopeType
      && String(granted.scopeId) === String(scope.scopeId)
      && (granted.permissions || []).includes(permission))),
  getCurrentAccount: jest.fn(),
}));
jest.mock('../../../modules/organization/public', () => ({
  getDepartmentById: jest.fn(),
  getTeamById: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  findById: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/schedule.repository', () => ({
  createShift: jest.fn(),
  createAssignment: jest.fn(),
  createCalendarOverride: jest.fn(),
  findAssignmentOverlaps: jest.fn(),
  findAssignmentById: jest.fn(),
  findCalendarConflict: jest.fn(),
  findCalendarOverrideById: jest.fn(),
  findShiftById: jest.fn(),
  findWorkLocationById: jest.fn(),
  updateAssignmentById: jest.fn(),
  updateCalendarOverrideById: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const organizationPublic = require('../../../modules/organization/public');
const profileRepository = require('../../../modules/hr/repositories/employeeProfile.repository');
const repository = require('../../../modules/hr/repositories/schedule.repository');
const service = require('../../../modules/hr/services/schedule.service');

const auth = {
  accountId: '660000000000000000000004',
  fullName: 'HR Admin',
  permissions: ['HR_SCHEDULE:READ', 'HR_SCHEDULE:WRITE'],
};
const validAssignment = {
  profileId,
  shiftId,
  workLocationId: locationId,
  effectiveFrom: '2026-07-01',
};

describe('schedule service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.getCurrentAccount.mockResolvedValue({ profile: { fullName: 'Verified Actor' } });
    profileRepository.findById.mockResolvedValue({ _id: profileId, status: 'ACTIVE', isDeleted: false });
    repository.findShiftById.mockResolvedValue({ _id: shiftId, status: 'ACTIVE' });
    repository.findWorkLocationById.mockResolvedValue({ _id: locationId, status: 'ACTIVE' });
    repository.findAssignmentOverlaps.mockResolvedValue([]);
    repository.findCalendarConflict.mockResolvedValue(null);
    organizationPublic.getDepartmentById.mockResolvedValue({ id: '660000000000000000000010', status: 'active' });
    organizationPublic.getTeamById.mockResolvedValue({ id: '660000000000000000000011', status: 'active' });
  });

  test('rejects an overlapping active assignment', async () => {
    repository.findAssignmentOverlaps.mockResolvedValue([{ _id: 'existing' }]);

    await expect(service.createAssignment(validAssignment, auth)).rejects.toMatchObject({
      code: 'CONFLICT_ERROR',
    });
  });

  test('rejects inactive assignment references', async () => {
    repository.findShiftById.mockResolvedValue({ _id: shiftId, status: 'SUSPENDED' });

    await expect(service.createAssignment(validAssignment, auth)).rejects.toMatchObject({
      code: 'CONFLICT_ERROR',
    });
  });

  test('rejects a department-scoped writer mutating a global shift configuration', async () => {
    repository.createShift.mockResolvedValue({
      _id: shiftId,
      code: 'OFFICE',
      name: 'Office hours',
      startTime: '08:00',
      endTime: '17:00',
      status: 'ACTIVE',
    });

    await expect(service.createShift({
      code: 'OFFICE',
      name: 'Office hours',
      startTime: '08:00',
      endTime: '17:00',
      status: 'ACTIVE',
    }, {
      scopes: [{
        scopeType: 'department',
        scopeId: '660000000000000000000010',
        permissions: ['HR_SCHEDULE:WRITE'],
      }],
    })).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
  });

  test('rejects a duplicate active calendar scope and date', async () => {
    repository.findCalendarConflict.mockResolvedValue({ _id: 'existing' });

    await expect(service.createCalendarOverride({
      dateKey: '2026-07-18',
      kind: 'HOLIDAY',
      scopeType: 'GLOBAL',
      scopeId: null,
      name: 'National Day',
    }, auth)).rejects.toMatchObject({
      code: 'CONFLICT_ERROR',
    });
  });

  test('accepts an active organization department calendar scope', async () => {
    repository.createCalendarOverride.mockResolvedValue({
      _id: '660000000000000000000020',
      dateKey: '2026-07-18',
      kind: 'HOLIDAY',
      scopeType: 'DEPARTMENT',
      scopeId: '660000000000000000000010',
      name: 'Department day',
      status: 'ACTIVE',
    });

    await expect(service.createCalendarOverride({
      dateKey: '2026-07-18',
      kind: 'HOLIDAY',
      scopeType: 'DEPARTMENT',
      scopeId: '660000000000000000000010',
      name: 'Department day',
    }, auth)).resolves.toMatchObject({ scopeType: 'DEPARTMENT' });
  });

  test('uses the authenticated profile name instead of auth context data for actor snapshots', async () => {
    repository.createAssignment.mockResolvedValue({
      _id: '660000000000000000000021',
      ...validAssignment,
      status: 'ACTIVE',
    });

    await service.createAssignment(validAssignment, { ...auth, fullName: 'Untrusted value' });

    expect(repository.createAssignment).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: { accountId: auth.accountId, fullName: 'Verified Actor' },
    }));
  });

  test('keeps actor name null when the authenticated account has no profile', async () => {
    authPublic.getCurrentAccount.mockResolvedValue({ profile: null });
    repository.createAssignment.mockResolvedValue({
      _id: '660000000000000000000026',
      ...validAssignment,
      status: 'ACTIVE',
    });

    await service.createAssignment(validAssignment, { ...auth, fullName: 'Untrusted value' });

    expect(repository.createAssignment).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: { accountId: auth.accountId, fullName: null },
    }));
  });

  test('rejects an invalid effective range after assignment patch merge', async () => {
    repository.findAssignmentById.mockResolvedValue({
      _id: '660000000000000000000022',
      ...validAssignment,
      effectiveTo: '2026-07-10',
      status: 'ACTIVE',
    });

    await expect(service.updateAssignment('660000000000000000000022', {
      effectiveFrom: '2026-07-11',
    }, auth)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('validates assignment references even while suspended', async () => {
    repository.findAssignmentById.mockResolvedValue({
      _id: '660000000000000000000023',
      ...validAssignment,
      status: 'SUSPENDED',
    });
    repository.findWorkLocationById.mockResolvedValue(null);

    await expect(service.updateAssignment('660000000000000000000023', {
      workLocationId: locationId,
    }, auth)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  test('normalizes global calendar scope on patch and rejects non-global scope without an id', async () => {
    repository.findCalendarOverrideById.mockResolvedValue({
      _id: '660000000000000000000024',
      dateKey: '2026-07-18',
      kind: 'HOLIDAY',
      scopeType: 'TEAM',
      scopeId: '660000000000000000000011',
      name: 'Team day',
      status: 'ACTIVE',
    });
    repository.updateCalendarOverrideById.mockResolvedValue({
      _id: '660000000000000000000024',
      dateKey: '2026-07-18',
      kind: 'HOLIDAY',
      scopeType: 'GLOBAL',
      scopeId: null,
      name: 'Team day',
      status: 'ACTIVE',
    });

    await service.updateCalendarOverride('660000000000000000000024', { scopeType: 'GLOBAL' }, auth);
    expect(repository.updateCalendarOverrideById).toHaveBeenCalledWith(
      '660000000000000000000024',
      expect.objectContaining({ scopeType: 'GLOBAL', scopeId: null }),
    );

    repository.findCalendarOverrideById.mockResolvedValue({
      _id: '660000000000000000000025',
      dateKey: '2026-07-18',
      kind: 'HOLIDAY',
      scopeType: 'GLOBAL',
      scopeId: null,
      name: 'Global day',
      status: 'ACTIVE',
    });
    await expect(service.updateCalendarOverride('660000000000000000000025', {
      scopeType: 'TEAM',
    }, auth)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
