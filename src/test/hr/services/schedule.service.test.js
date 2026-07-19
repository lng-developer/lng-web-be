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
  listDepartmentsByIds: jest.fn(),
  listTeamsByIds: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  findById: jest.fn(),
  listIds: jest.fn(),
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
  findWorkLocationsByIds: jest.fn(),
  listAssignments: jest.fn(),
  listCalendarOverrides: jest.fn(),
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
    organizationPublic.listDepartmentsByIds.mockResolvedValue([]);
    organizationPublic.listTeamsByIds.mockResolvedValue([]);
    repository.findWorkLocationsByIds.mockResolvedValue([]);
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

  test('paginates scoped assignments before profile reads', async () => {
    const scopedAuth = {
      scopes: [{
        scopeType: 'team',
        scopeId: '660000000000000000000011',
        permissions: ['HR_SCHEDULE:READ'],
      }],
    };
    const scopedAssignment = {
      _id: '660000000000000000000031',
      ...validAssignment,
      status: 'ACTIVE',
    };
    profileRepository.listIds.mockResolvedValue([{ _id: profileId }]);
    repository.listAssignments.mockImplementation(({ profileIds } = {}) => Promise.resolve(profileIds
      ? { items: [scopedAssignment], pagination: { page: 1, limit: 1, total: 1 } }
      : {
        items: [{ ...scopedAssignment, profileId: '660000000000000000000032' }],
        pagination: { page: 1, limit: 1, total: 2 },
      }));

    await expect(service.listAssignments({ page: 1, limit: 1 }, scopedAuth)).resolves.toMatchObject({
      items: [{ id: '660000000000000000000031' }],
      pagination: { page: 1, limit: 1, total: 1 },
    });
    expect(repository.listAssignments).toHaveBeenCalledWith(expect.objectContaining({
      profileIds: [profileId],
    }));
    expect(profileRepository.findById).not.toHaveBeenCalled();
  });

  test('paginates scoped profile overrides before profile reads', async () => {
    const scopedAuth = {
      scopes: [{
        scopeType: 'team',
        scopeId: '660000000000000000000011',
        permissions: ['HR_SCHEDULE:READ'],
      }],
    };
    const scopedOverride = {
      _id: '660000000000000000000033',
      dateKey: '2026-07-18',
      kind: 'HOLIDAY',
      scopeType: 'PROFILE',
      scopeId: profileId,
      name: 'Scoped day',
      status: 'ACTIVE',
    };
    profileRepository.listIds.mockResolvedValue([{ _id: profileId }]);
    repository.listCalendarOverrides.mockImplementation(({ scopeFilters } = {}) => Promise.resolve(scopeFilters
      ? { items: [scopedOverride], pagination: { page: 1, limit: 1, total: 1 } }
      : {
        items: [{ ...scopedOverride, scopeType: 'WORK_LOCATION', scopeId: locationId }],
        pagination: { page: 1, limit: 1, total: 2 },
      }));

    await expect(service.listCalendarOverrides({ page: 1, limit: 1 }, scopedAuth)).resolves.toMatchObject({
      items: [{ id: '660000000000000000000033' }],
      pagination: { page: 1, limit: 1, total: 1 },
    });
    expect(repository.listCalendarOverrides).toHaveBeenCalledWith(expect.objectContaining({
      scopeFilters: expect.arrayContaining([
        { scopeType: 'PROFILE', scopeId: { $in: [profileId] } },
      ]),
    }));
    expect(profileRepository.findById).not.toHaveBeenCalled();
  });

  test('batches readable labels for department, team, and work-location calendar scopes', async () => {
    const departmentScopeId = '660000000000000000000010';
    const teamScopeId = '660000000000000000000011';
    repository.listCalendarOverrides.mockResolvedValue({
      items: [
        { _id: '660000000000000000000034', scopeType: 'DEPARTMENT', scopeId: departmentScopeId },
        { _id: '660000000000000000000035', scopeType: 'TEAM', scopeId: teamScopeId },
        { _id: '660000000000000000000036', scopeType: 'WORK_LOCATION', scopeId: locationId },
      ],
      pagination: { page: 1, limit: 20, total: 3 },
    });
    organizationPublic.listDepartmentsByIds.mockResolvedValue([{ _id: departmentScopeId, code: 'OPS', name: 'Operations' }]);
    organizationPublic.listTeamsByIds.mockResolvedValue([{ _id: teamScopeId, code: 'OPS-A', name: 'Operations A' }]);
    repository.findWorkLocationsByIds.mockResolvedValue([{ _id: locationId, code: 'HCM', name: 'HCM Office' }]);

    const result = await service.listCalendarOverrides({}, auth);

    expect(result.items.map((item) => item.scopeTarget)).toEqual([
      { id: departmentScopeId, code: 'OPS', name: 'Operations' },
      { id: teamScopeId, code: 'OPS-A', name: 'Operations A' },
      { id: locationId, code: 'HCM', name: 'HCM Office' },
    ]);
    expect(organizationPublic.listDepartmentsByIds).toHaveBeenCalledWith([departmentScopeId]);
    expect(organizationPublic.listTeamsByIds).toHaveBeenCalledWith([teamScopeId]);
    expect(repository.findWorkLocationsByIds).toHaveBeenCalledWith([locationId]);
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
