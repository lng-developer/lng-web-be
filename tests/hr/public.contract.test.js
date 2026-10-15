jest.mock('../../src/modules/hr/repositories/employeeProfile.repository', () => ({
  findByAccountId: jest.fn(),
  findPublicByAccountId: jest.fn(),
  findPublicByEmployeeCode: jest.fn(),
  listPublicByAccountIds: jest.fn(),
  listPublicByEmployeeCodes: jest.fn(),
  listPublicProfiles: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../../src/modules/auth/public', () => ({ filterAssignableAccountIds: jest.fn() }));

const repository = require('../../src/modules/hr/repositories/employeeProfile.repository');
const hrPublic = require('../../src/modules/hr/public');
const authPublic = require('../../src/modules/auth/public');

const unsafeProfile = {
  _id: 'profile-1',
  accountId: 'account-1',
  employeeCode: 'J2501',
  fullName: 'Jane Nguyen',
  departmentId: 'department-1',
  teamId: 'team-1',
  status: 'ACTIVE',
  isProfileUpdated: true,
  avatarAssetId: 'asset-1',
  avatarUrl: null,
  birthDate: new Date('1990-01-01'),
  phoneNumber: 'secret',
  address: 'secret',
  personalEmail: 'secret@example.com',
  emergencyContact: { name: 'secret' },
  contractNumber: 'secret',
  dependantDetails: [{ name: 'secret' }],
};

const safeProfile = {
  id: 'profile-1',
  accountId: 'account-1',
  employeeCode: 'J2501',
  fullName: 'Jane Nguyen',
  displayName: 'Jane Nguyen',
  departmentId: 'department-1',
  teamId: 'team-1',
  status: 'ACTIVE',
  isProfileUpdated: true,
  avatarUrl: '/api/hr/employee-profiles/profile-1/avatar',
};

describe('hr public port', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    repository.findPublicByAccountId.mockResolvedValue(unsafeProfile);
    repository.findByAccountId.mockResolvedValue(unsafeProfile);
    repository.findPublicByEmployeeCode.mockResolvedValue(unsafeProfile);
    repository.listPublicByAccountIds.mockResolvedValue([unsafeProfile]);
    repository.listPublicByEmployeeCodes.mockResolvedValue([unsafeProfile]);
    repository.listPublicProfiles.mockResolvedValue([unsafeProfile]);
    repository.updateById.mockResolvedValue({
      ...unsafeProfile,
      departmentId: 'department-2',
      teamId: 'team-2',
    });
    authPublic.filterAssignableAccountIds.mockResolvedValue(['account-1']);
  });

  test('restores stable employee profile lookup ports', () => {
    expect(typeof hrPublic.getEmployeeProfileByAccountId).toBe('function');
    expect(typeof hrPublic.getEmployeeProfileByEmployeeCode).toBe('function');
    expect(typeof hrPublic.listEmployeeProfilesByAccountIds).toBe('function');
    expect(typeof hrPublic.listEmployeeProfilesByEmployeeCodes).toBe('function');
    expect(typeof hrPublic.listAssignableProfiles).toBe('function');
  });

  test('returns only the minimal safe profile shape from every lookup under any options', async () => {
    await expect(
      hrPublic.getEmployeeProfileByAccountId('account-1', { includeSensitive: true }),
    ).resolves.toEqual(safeProfile);
    await expect(
      hrPublic.getEmployeeProfileByEmployeeCode('J2501', { includeSensitive: true }),
    ).resolves.toEqual(safeProfile);
    await expect(
      hrPublic.listEmployeeProfilesByAccountIds(['account-1'], { includeSensitive: true }),
    ).resolves.toEqual([safeProfile]);
    expect(repository.findPublicByAccountId).toHaveBeenCalledWith(
      'account-1',
      { includeSensitive: true },
    );
    expect(repository.findPublicByEmployeeCode).toHaveBeenCalledWith(
      'J2501',
      { includeSensitive: true },
    );
    expect(repository.listPublicByAccountIds).toHaveBeenCalledWith(
      ['account-1'],
      { includeSensitive: true },
    );

    const serialized = JSON.stringify([
      await hrPublic.getEmployeeProfileByAccountId('account-1'),
      await hrPublic.getEmployeeProfileByEmployeeCode('J2501'),
      ...(await hrPublic.listEmployeeProfilesByAccountIds(['account-1'])),
    ]);
    expect(serialized).not.toMatch(
      /birthDate|phone|address|email|emergency|contract|dependant|salary|bank|identity/i,
    );
  });

  test('filters assignable HR profiles through active Auth accounts', async () => {
    await expect(hrPublic.listAssignableProfiles({
      search: 'Jane',
      requiredPermission: 'DESIGN:WRITE',
      teamIds: ['team-1'],
    }))
      .resolves.toEqual([safeProfile]);
    expect(repository.listPublicProfiles).toHaveBeenCalledWith(expect.objectContaining({
      search: 'Jane',
      teamIds: ['team-1'],
    }));
    expect(authPublic.filterAssignableAccountIds).toHaveBeenCalledWith(
      ['account-1'],
      'DESIGN:WRITE',
    );
  });

  test('synchronizes a profile team and its owning department together', async () => {
    const session = { id: 'organization-transaction' };

    await hrPublic.syncEmployeeProfileTeam('account-1', 'team-2', {
      departmentId: 'department-2',
      session,
    });

    expect(repository.updateById).toHaveBeenCalledWith(
      'profile-1',
      { teamId: 'team-2', departmentId: 'department-2' },
      { session },
    );
  });
});
