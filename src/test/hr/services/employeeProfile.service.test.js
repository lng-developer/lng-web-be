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
  getTeamById: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  create: jest.fn(),
  findByAccountId: jest.fn(),
  findByEmployeeCode: jest.fn(),
  findById: jest.fn(),
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
});
