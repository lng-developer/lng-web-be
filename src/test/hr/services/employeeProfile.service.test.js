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

    expect(result.items[0].capabilities).toEqual({ edit: true });
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
