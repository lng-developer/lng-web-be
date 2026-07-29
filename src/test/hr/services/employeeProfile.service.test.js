const accountId = '660000000000000000000001';
const departmentId = '660000000000000000000002';
const teamId = '660000000000000000000003';

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn((authContext, permission, scope) => (authContext.permissions || []).includes(permission)
    || (authContext.scopes || []).some((granted) => granted.scopeType === scope.scopeType
      && String(granted.scopeId) === String(scope.scopeId)
      && (granted.permissions || []).includes(permission))),
  getCurrentAccount: jest.fn(),
}));
jest.mock('../../../modules/organization/public', () => ({
  getDepartmentById: jest.fn(),
  listAccountOrganizationSummaries: jest.fn(),
  getTeamById: jest.fn(),
}));
jest.mock('../../../modules/audit/public', () => ({
  record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  create: jest.fn(),
  findByAccountId: jest.fn(),
  findByEmployeeCode: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  restore: jest.fn(),
  softDelete: jest.fn(),
  updateById: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const auditPublic = require('../../../modules/audit/public');
const organizationPublic = require('../../../modules/organization/public');
const repository = require('../../../modules/hr/repositories/employeeProfile.repository');
const service = require('../../../modules/hr/services/employeeProfile.service');

describe('employeeProfile service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.getCurrentAccount.mockResolvedValue({ account: { _id: accountId, status: 'active' } });
    repository.findByAccountId.mockResolvedValue(null);
    repository.findByEmployeeCode.mockResolvedValue(null);
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([]);
  });

  test('derives department from the selected active team', async () => {
    organizationPublic.getTeamById.mockResolvedValue({ id: teamId, departmentId, status: 'ACTIVE' });
    repository.create.mockResolvedValue({
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId,
      teamId,
    });

    const result = await service.createProfile({
      accountId,
      employeeCode: 'j2501',
      fullName: 'Jane Nguyen',
      teamId,
    }, { permissions: ['HR_EMPLOYEES:WRITE'] });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      employeeCode: 'J2501',
      departmentId,
      teamId,
    }));
    expect(result.departmentId).toBe(departmentId);
  });

  test('audits profile lifecycle mutations and sensitive reads without employee PII', async () => {
    const profileId = '660000000000000000000004';
    const auth = { accountId, permissions: ['HR_EMPLOYEES:WRITE', 'HR_COMPENSATION:READ'] };
    const persisted = {
      _id: profileId,
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      birthDate: '1990-01-01',
      phoneNumber: '0900000000',
      address: 'Private address',
      baseSalary: 10000000,
      departmentId,
      teamId,
      updatedAt: new Date('2026-07-29T01:00:00.000Z'),
    };
    organizationPublic.getDepartmentById.mockResolvedValue({ id: departmentId, status: 'ACTIVE' });
    organizationPublic.getTeamById.mockResolvedValue({ id: teamId, departmentId, status: 'ACTIVE' });
    repository.create.mockResolvedValue(persisted);
    repository.findById.mockResolvedValue(persisted);
    repository.updateById.mockResolvedValue(persisted);
    repository.softDelete.mockResolvedValue({ ...persisted, isDeleted: true });
    repository.restore.mockResolvedValue({ ...persisted, isDeleted: false });

    await service.createProfile({
      accountId, employeeCode: 'J2501', fullName: 'Jane Nguyen', teamId,
    }, auth);
    await service.updateProfile(profileId, { jobTitle: 'Lead', phoneNumber: '0911111111' }, auth);
    await service.deleteProfile(profileId, auth);
    await service.restoreProfile(profileId, auth);
    await service.getProfile(profileId, auth, { includeSensitive: true });

    expect(auditPublic.record.mock.calls.map(([event]) => event.action)).toEqual([
      'HR_EMPLOYEE_PROFILE_CREATED',
      'HR_EMPLOYEE_PROFILE_UPDATED',
      'HR_EMPLOYEE_PROFILE_DELETED',
      'HR_EMPLOYEE_PROFILE_RESTORED',
      'HR_EMPLOYEE_PROFILE_SENSITIVE_READ',
    ]);
    for (const [event] of auditPublic.record.mock.calls) {
      expect(JSON.stringify(event)).not.toMatch(/Jane Nguyen|0900000000|0911111111|Private address|1990-01-01|10000000/);
    }
  });

  test('rejects sensitive updates without compensation write permission', async () => {
    await expect(service.createProfile({
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      baseCurrency: 'USD',
      baseSalary: 10000000,
    }, { permissions: ['HR_EMPLOYEES:WRITE'] })).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });

  test('keeps sensitive data out of profile detail unless explicitly requested', async () => {
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      baseSalary: 10000000,
    });

    const result = await service.getProfile('660000000000000000000004', {
      permissions: ['HR_COMPENSATION:READ', 'HR_EMPLOYEES:READ'],
    });

    expect(repository.findById).toHaveBeenCalledWith('660000000000000000000004', { includeSensitive: false });
    expect(result.baseCurrency).toBeUndefined();
    expect(result.baseSalary).toBeUndefined();
  });

  test('rejects a department-scoped reader requesting a profile outside its scope', async () => {
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId: '660000000000000000000099',
      teamId,
    });

    await expect(service.getProfile('660000000000000000000004', {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:READ'],
      }],
    })).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403,
    });
  });

  test('allows a schedule-only scoped directory read without PII', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
        birthDate: '1990-01-01',
        phoneNumber: '0900000000',
        personalEmail: 'jane@example.com',
        bankAccount: { accountNumber: '123' },
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });

    const result = await service.listProfiles({}, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_SCHEDULE:READ'],
      }],
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      scopeFilters: [{ departmentId }],
    }));
    expect(result.items[0]).toMatchObject({ employeeCode: 'J2501', fullName: 'Jane Nguyen' });
    expect(result.items[0]).not.toHaveProperty('birthDate');
    expect(result.items[0]).not.toHaveProperty('phoneNumber');
    expect(result.items[0]).not.toHaveProperty('personalEmail');
    expect(result.items[0]).not.toHaveProperty('bankAccount');
  });

  test('allows a calendar-only team-scoped directory read without sensitive fields', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
        personalEmail: 'jane@example.com',
        bankAccount: { accountNumber: '123' },
        baseSalary: 10000000,
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });

    const result = await service.listProfiles({}, {
      scopes: [{
        scopeType: 'team',
        scopeId: teamId,
        permissions: ['HR_CALENDAR:READ'],
      }],
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      scopeFilters: [{ teamId }],
    }));
    expect(result.items[0]).toMatchObject({ employeeCode: 'J2501', fullName: 'Jane Nguyen' });
    expect(result.items[0]).not.toHaveProperty('personalEmail');
    expect(result.items[0]).not.toHaveProperty('bankAccount');
    expect(result.items[0]).not.toHaveProperty('baseSalary');
  });

  test('global calendar writer receives the non-sensitive directory with team labels', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
        personalEmail: 'jane@example.com',
        baseSalary: 10000000,
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId,
      department: { id: departmentId, name: 'Production' },
      team: { id: teamId, name: 'Team A' },
    }]);

    const result = await service.listProfiles({}, { permissions: ['HR_CALENDAR:WRITE'] });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ scopeFilters: [] }));
    expect(result.items[0]).toMatchObject({
      employeeCode: 'J2501',
      team: { id: teamId, name: 'Team A' },
    });
    expect(result.items[0]).not.toHaveProperty('personalEmail');
    expect(result.items[0]).not.toHaveProperty('baseSalary');
  });

  test('sets directory edit capability from employee-write scope', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });

    const result = await service.listProfiles({}, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:WRITE'],
      }],
    });

    expect(result.items[0].capabilities).toEqual({ edit: true, delete: true, restore: false });
  });

  test('returns mutually exclusive directory capabilities for active and deleted profiles', async () => {
    const activeId = '660000000000000000000004';
    const deletedId = '660000000000000000000005';
    repository.list.mockResolvedValue({
      items: [
        { _id: activeId, accountId, employeeCode: 'ACTIVE', fullName: 'Active', departmentId, teamId },
        {
          _id: deletedId,
          accountId: '660000000000000000000006',
          employeeCode: 'DELETED',
          fullName: 'Deleted',
          departmentId,
          teamId,
          isDeleted: true,
          deletedAt: new Date('2026-07-28T00:00:00.000Z'),
        },
      ],
      pagination: { page: 1, limit: 20, total: 2 },
    });

    const result = await service.listProfiles({ includeDeleted: true }, {
      permissions: ['HR_EMPLOYEES:WRITE'],
    });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: activeId,
        isDeleted: false,
        capabilities: { edit: true, delete: true, restore: false },
      }),
      expect.objectContaining({
        id: deletedId,
        isDeleted: true,
        capabilities: { edit: false, delete: false, restore: true },
      }),
    ]));
  });

  test('rejects a scoped writer creating a profile outside its department', async () => {
    const otherDepartmentId = '660000000000000000000099';
    organizationPublic.getDepartmentById.mockResolvedValue({
      _id: otherDepartmentId,
      status: 'ACTIVE',
    });

    await expect(service.createProfile({
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId: otherDepartmentId,
    }, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:WRITE'],
      }],
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR', statusCode: 403 });

    expect(repository.create).not.toHaveBeenCalled();
  });

  test('rejects moving a profile from an allowed department to an unauthorized team', async () => {
    const otherDepartmentId = '660000000000000000000098';
    const otherTeamId = '660000000000000000000099';
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000004',
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId,
      teamId,
    });
    organizationPublic.getDepartmentById.mockResolvedValue({
      _id: otherDepartmentId,
      status: 'ACTIVE',
    });
    organizationPublic.getTeamById.mockResolvedValue({
      _id: otherTeamId,
      departmentId: otherDepartmentId,
      status: 'ACTIVE',
    });

    await expect(service.updateProfile('660000000000000000000004', {
      departmentId: otherDepartmentId,
      teamId: otherTeamId,
    }, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:WRITE'],
      }],
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR', statusCode: 403 });

    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('rejects deleting or restoring a profile outside employee-write scope', async () => {
    const profileId = '660000000000000000000004';
    repository.findById.mockResolvedValue({
      _id: profileId,
      accountId,
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId: '660000000000000000000099',
      teamId: null,
    });
    const scopedWriter = {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_EMPLOYEES:WRITE'],
      }],
    };

    await expect(service.deleteProfile(profileId, scopedWriter))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR', statusCode: 403 });
    await expect(service.restoreProfile(profileId, scopedWriter))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_ERROR', statusCode: 403 });

    expect(repository.softDelete).not.toHaveBeenCalled();
    expect(repository.restore).not.toHaveBeenCalled();
  });

  test('allows an attendance operator to list only its scoped directory projection', async () => {
    repository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000000004',
        accountId,
        employeeCode: 'J2501',
        fullName: 'Jane Nguyen',
        departmentId,
        teamId,
        personalEmail: 'jane@example.com',
        baseSalary: 10000000,
      }],
      pagination: { page: 1, limit: 20, total: 1 },
    });

    const result = await service.listProfiles({}, {
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['HR_ATTENDANCE:MANAGE'],
      }],
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      scopeFilters: [{ departmentId }],
    }));
    expect(result.items[0]).toMatchObject({ employeeCode: 'J2501', fullName: 'Jane Nguyen' });
    expect(result.items[0]).not.toHaveProperty('personalEmail');
    expect(result.items[0]).not.toHaveProperty('baseSalary');
  });
});
