const crypto = require('crypto');
const mongoose = require('mongoose');

const profileId = '660000000000000000000001';
const shiftId = '660000000000000000000002';
const locationId = '660000000000000000000003';

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn((authContext, permission, scope) => (authContext.permissions || []).includes(permission)
    || (authContext.scopes || []).some((granted) => granted.scopeType === scope.scopeType
      && String(granted.scopeId) === String(scope.scopeId)
      && (granted.permissions || []).includes(permission))),
  getCurrentAccount: jest.fn(),
}));
jest.mock('../../../src/modules/organization/public', () => ({
  getDepartmentById: jest.fn(),
  getTeamById: jest.fn(),
  listDepartmentsByIds: jest.fn(),
  listTeamsByIds: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
}));
jest.mock('../../../src/modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
  findById: jest.fn(),
  listIds: jest.fn(),
  touchScheduleMutation: jest.fn(),
}));
jest.mock('../../../src/modules/hr/repositories/schedule.repository', () => ({
  createWorkLocation: jest.fn(),
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
  listShifts: jest.fn(),
  listAssignments: jest.fn(),
  listCalendarOverrides: jest.fn(),
  updateWorkLocationById: jest.fn(),
  updateShiftById: jest.fn(),
  updateAssignmentById: jest.fn(),
  updateCalendarOverrideById: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const auditPublic = require('../../../src/modules/audit/public');
const organizationPublic = require('../../../src/modules/organization/public');
const profileRepository = require('../../../src/modules/hr/repositories/employeeProfile.repository');
const repository = require('../../../src/modules/hr/repositories/schedule.repository');
const service = require('../../../src/modules/hr/services/schedule.service');

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
const transactionSession = {
  withTransaction: jest.fn(async (work) => work()),
  endSession: jest.fn(),
};

describe('schedule service', () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.clearAllMocks();
    profileRepository.findByAccountId.mockResolvedValue({ accountId: auth.accountId, fullName: 'Verified Actor' });
    authPublic.getCurrentAccount.mockResolvedValue({ account: { email: 'verified.actor@lng.co' } });
    profileRepository.findById.mockResolvedValue({
      _id: profileId,
      departmentId: '660000000000000000000010',
      teamId: '660000000000000000000011',
      status: 'ACTIVE',
      isDeleted: false,
    });
    repository.findShiftById.mockResolvedValue({ _id: shiftId, status: 'ACTIVE' });
    repository.findWorkLocationById.mockResolvedValue({ _id: locationId, status: 'ACTIVE' });
    repository.findAssignmentOverlaps.mockResolvedValue([]);
    repository.findCalendarConflict.mockResolvedValue(null);
    organizationPublic.getDepartmentById.mockResolvedValue({ id: '660000000000000000000010', status: 'active' });
    organizationPublic.getTeamById.mockResolvedValue({ id: '660000000000000000000011', status: 'active' });
    organizationPublic.listDepartmentsByIds.mockResolvedValue([]);
    organizationPublic.listTeamsByIds.mockResolvedValue([]);
    repository.findWorkLocationsByIds.mockResolvedValue([]);
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(transactionSession);
  });

  test('locks the profile and writes an assignment in one transaction', async () => {
    repository.createAssignment.mockResolvedValue({
      _id: '660000000000000000000021', ...validAssignment, status: 'ACTIVE',
    });

    await service.createAssignment(validAssignment, auth);

    const session = transactionSession;
    expect(profileRepository.touchScheduleMutation).toHaveBeenCalledWith(profileId, { session });
    expect(repository.findAssignmentOverlaps).toHaveBeenCalledWith(
      profileId, '2026-07-01', undefined, undefined, { session },
    );
    expect(repository.createAssignment).toHaveBeenCalledWith(expect.objectContaining({
      profileId,
    }), { session });
  });

  test('rejects an assignment location that differs from its fixed shift location', async () => {
    repository.findShiftById.mockResolvedValue({
      _id: shiftId, status: 'ACTIVE', workLocationId: '660000000000000000000099',
    });

    await expect(service.createAssignment(validAssignment, auth)).rejects.toMatchObject({
      statusCode: 400, code: 'VALIDATION_ERROR',
    });
    expect(repository.createAssignment).not.toHaveBeenCalled();
  });

  test('rejects a partial shift update whose break consumes the whole duration', async () => {
    repository.findShiftById.mockResolvedValue({
      _id: shiftId, status: 'ACTIVE', startTime: '08:00', endTime: '17:00', breakMinutes: 60,
    });

    await expect(service.updateShift(shiftId, { breakMinutes: 540 }, auth)).rejects.toMatchObject({
      statusCode: 400, code: 'VALIDATION_ERROR',
    });
    expect(repository.updateShiftById).not.toHaveBeenCalled();
  });

  test('does not persist or audit a no-op work-location update', async () => {
    repository.findWorkLocationById.mockResolvedValue({
      _id: locationId, code: 'HCM', name: 'HCM Office', timezone: 'Asia/Ho_Chi_Minh', status: 'ACTIVE',
    });

    await service.updateWorkLocation(locationId, { name: 'HCM Office' }, auth);

    expect(repository.updateWorkLocationById).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('does not persist or audit a no-op shift update', async () => {
    repository.findShiftById.mockResolvedValue({
      _id: shiftId, code: 'DAY', name: 'Day', startTime: '08:00', endTime: '17:00',
      breakMinutes: 60, workdays: [1, 2, 3, 4, 5], status: 'ACTIVE',
    });

    await service.updateShift(shiftId, { name: 'Day', workdays: [1, 2, 3, 4, 5] }, auth);

    expect(repository.updateShiftById).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('does not start a transaction or audit a no-op assignment update', async () => {
    const assignmentId = '660000000000000000000022';
    repository.findAssignmentById.mockResolvedValue({
      _id: assignmentId, ...validAssignment, effectiveTo: null, status: 'ACTIVE',
    });

    await service.updateAssignment(assignmentId, { effectiveTo: null }, auth);

    expect(mongoose.startSession).not.toHaveBeenCalled();
    expect(repository.updateAssignmentById).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test.each([
    ['before employment starts', { startDate: new Date('2026-07-02T00:00:00.000Z') }, { effectiveFrom: '2026-07-01' }],
    ['after employment ends', { endDate: new Date('2026-07-10T00:00:00.000Z') }, { effectiveFrom: '2026-07-01', effectiveTo: '2026-07-11' }],
    ['open ended after employment has an end', { endDate: new Date('2026-07-10T00:00:00.000Z') }, { effectiveFrom: '2026-07-01' }],
  ])('rejects assignment %s', async (_label, profileDates, assignmentDates) => {
    profileRepository.findById.mockResolvedValue({
      _id: profileId, departmentId: '660000000000000000000010',
      teamId: '660000000000000000000011', status: 'ACTIVE', isDeleted: false,
      ...profileDates,
    });

    await expect(service.createAssignment({
      ...validAssignment, ...assignmentDates,
    }, auth)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(repository.createAssignment).not.toHaveBeenCalled();
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

  test('audits every schedule mutation with entity scope and no employee snapshot PII', async () => {
    const assignmentId = '660000000000000000000021';
    const overrideId = '660000000000000000000022';
    const updatedAt = new Date('2026-07-29T02:00:00.000Z');
    const workLocation = {
      _id: locationId, code: 'HCM', name: 'HCM Office', timezone: 'Asia/Ho_Chi_Minh',
      status: 'ACTIVE', updatedAt,
    };
    const shift = {
      _id: shiftId, code: 'DAY', name: 'Day', startTime: '08:00', endTime: '17:00',
      status: 'ACTIVE', updatedAt,
    };
    const assignment = {
      _id: assignmentId, ...validAssignment, status: 'ACTIVE', updatedAt,
    };
    const override = {
      _id: overrideId, dateKey: '2026-07-29', kind: 'HOLIDAY',
      scopeType: 'TEAM', scopeId: '660000000000000000000011', status: 'ACTIVE', updatedAt,
    };
    repository.createWorkLocation.mockResolvedValue(workLocation);
    repository.updateWorkLocationById.mockResolvedValue(workLocation);
    repository.createShift.mockResolvedValue(shift);
    repository.findShiftById.mockResolvedValue(shift);
    repository.updateShiftById.mockResolvedValue(shift);
    repository.createAssignment.mockResolvedValue(assignment);
    repository.findAssignmentById.mockResolvedValue(assignment);
    repository.updateAssignmentById.mockResolvedValue(assignment);
    repository.createCalendarOverride.mockResolvedValue(override);
    repository.findCalendarOverrideById.mockResolvedValue(override);
    repository.updateCalendarOverrideById.mockResolvedValue(override);

    await service.createWorkLocation(workLocation, auth);
    await service.updateWorkLocation(locationId, { name: 'HCM' }, auth);
    await service.createShift(shift, auth);
    await service.updateShift(shiftId, { name: 'Day shift' }, auth);
    await service.createAssignment(validAssignment, auth);
    await service.updateAssignment(assignmentId, { effectiveTo: '2026-12-31' }, auth);
    await service.createCalendarOverride(override, auth);
    await service.updateCalendarOverride(overrideId, { kind: 'WORKING_DAY' }, auth);

    expect(auditPublic.record.mock.calls.map(([event]) => event.action)).toEqual([
      'HR_WORK_LOCATION_CREATED',
      'HR_WORK_LOCATION_UPDATED',
      'HR_SHIFT_CREATED',
      'HR_SHIFT_UPDATED',
      'HR_SHIFT_ASSIGNMENT_CREATED',
      'HR_SHIFT_ASSIGNMENT_UPDATED',
      'HR_CALENDAR_OVERRIDE_CREATED',
      'HR_CALENDAR_OVERRIDE_UPDATED',
    ]);
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_SHIFT_ASSIGNMENT_CREATED',
      scopeType: 'TEAM',
      scopeId: '660000000000000000000011',
    }), {});
    expect(JSON.stringify(auditPublic.record.mock.calls)).not.toMatch(/Verified Actor|verified\.actor@lng\.co/);
  });

  test('gives same-timestamp schedule updates distinct server mutation identities', async () => {
    const persisted = {
      _id: locationId,
      code: 'HCM',
      name: 'HCM Office',
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'ACTIVE',
      updatedAt: new Date('2026-07-29T02:00:00.000Z'),
    };
    jest.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000021')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000022');
    repository.updateWorkLocationById.mockResolvedValue(persisted);

    await service.updateWorkLocation(locationId, { name: 'HCM One' }, auth);
    await service.updateWorkLocation(locationId, { name: 'HCM Two' }, auth);

    expect(auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey)).toEqual([
      `hr:hr_work_location_updated:${locationId}:00000000-0000-4000-8000-000000000021`,
      `hr:hr_work_location_updated:${locationId}:00000000-0000-4000-8000-000000000022`,
    ]);
  });

  test('scopes profile calendar override audits to the resolved employee team', async () => {
    const overrideId = '660000000000000000000022';
    repository.createCalendarOverride.mockResolvedValue({
      _id: overrideId,
      dateKey: '2026-07-29',
      kind: 'HOLIDAY',
      scopeType: 'PROFILE',
      scopeId: profileId,
      status: 'ACTIVE',
    });

    await service.createCalendarOverride({
      dateKey: '2026-07-29', kind: 'HOLIDAY', scopeType: 'PROFILE', scopeId: profileId,
    }, auth);

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'HR_CALENDAR_OVERRIDE_CREATED',
      scopeType: 'TEAM',
      scopeId: '660000000000000000000011',
    }), {});
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
    }), { session: transactionSession });
  });

  test('uses account email when the authenticated account has no HR profile', async () => {
    profileRepository.findByAccountId.mockResolvedValue(null);
    authPublic.getCurrentAccount.mockResolvedValue({ account: { email: 'system@lng.co' } });
    repository.createAssignment.mockResolvedValue({
      _id: '660000000000000000000026',
      ...validAssignment,
      status: 'ACTIVE',
    });

    await service.createAssignment(validAssignment, { ...auth, fullName: 'Untrusted value' });

    expect(repository.createAssignment).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: { accountId: auth.accountId, fullName: 'system@lng.co' },
    }), { session: transactionSession });
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
      workLocationId: '660000000000000000000099',
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

  test('returns assignment summary counts from the full filtered result set', async () => {
    const summary = { total: 3, statusCounts: { ACTIVE: 2, SUSPENDED: 1 } };
    repository.listAssignments.mockResolvedValue({
      items: [{
        _id: '660000000000000000000040',
        profileId,
        shiftId,
        workLocationId: locationId,
        status: 'ACTIVE',
      }],
      pagination: { page: 1, limit: 1, total: 3 },
      summary,
    });

    const result = await service.listAssignments({ page: 1, limit: 1 }, auth);

    expect(result.summary).toEqual(summary);
  });

  test('returns shift work-location summaries with one batch lookup', async () => {
    repository.listShifts.mockResolvedValue({
      items: [{ _id: shiftId, code: 'DAY', name: 'Day shift', workLocationId: locationId }],
      pagination: { page: 1, limit: 10, total: 1 },
    });
    repository.findWorkLocationsByIds.mockResolvedValue([
      { _id: locationId, code: 'HCM', name: 'Ho Chi Minh', timezone: 'Asia/Ho_Chi_Minh' },
    ]);

    await expect(service.listShifts({ page: 1, limit: 10 })).resolves.toMatchObject({
      items: [{
        id: shiftId,
        workLocation: { id: locationId, code: 'HCM', name: 'Ho Chi Minh', timezone: 'Asia/Ho_Chi_Minh' },
      }],
    });
    expect(repository.findWorkLocationsByIds).toHaveBeenCalledWith([locationId]);
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

  test('does not persist or audit a no-op calendar override update', async () => {
    const overrideId = '660000000000000000000024';
    repository.findCalendarOverrideById.mockResolvedValue({
      _id: overrideId, dateKey: '2026-07-18', kind: 'HOLIDAY',
      scopeType: 'GLOBAL', scopeId: null, name: 'Company holiday', status: 'ACTIVE',
    });

    await service.updateCalendarOverride(overrideId, { name: 'Company holiday' }, auth);

    expect(repository.updateCalendarOverrideById).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', null, 'RESOURCE_NOT_FOUND'],
    ['inactive', { id: '660000000000000000000099', status: 'inactive' }, 'CONFLICT_ERROR'],
  ])('rejects a %s destination team for a calendar override', async (_label, team, code) => {
    const overrideId = '660000000000000000000024';
    repository.findCalendarOverrideById.mockResolvedValue({
      _id: overrideId, dateKey: '2026-07-18', kind: 'HOLIDAY',
      scopeType: 'GLOBAL', scopeId: null, name: 'Company holiday', status: 'ACTIVE',
    });
    organizationPublic.getTeamById.mockResolvedValue(team);

    await expect(service.updateCalendarOverride(overrideId, {
      scopeType: 'TEAM', scopeId: '660000000000000000000099',
    }, auth)).rejects.toMatchObject({ code });
    expect(repository.updateCalendarOverrideById).not.toHaveBeenCalled();
  });
});
