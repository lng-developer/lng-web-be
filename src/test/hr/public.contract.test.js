jest.mock('../../modules/hr/repositories/employeeProfile.repository', () => ({
  findPublicByAccountId: jest.fn(),
  findPublicByEmployeeCode: jest.fn(),
  listPublicByAccountIds: jest.fn(),
}));

const repository = require('../../modules/hr/repositories/employeeProfile.repository');
const hrPublic = require('../../modules/hr/public');

const unsafeProfile = {
  _id: 'profile-1',
  accountId: 'account-1',
  employeeCode: 'J2501',
  fullName: 'Jane Nguyen',
  departmentId: 'department-1',
  teamId: 'team-1',
  status: 'ACTIVE',
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
};

describe('hr public port', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    repository.findPublicByAccountId.mockResolvedValue(unsafeProfile);
    repository.findPublicByEmployeeCode.mockResolvedValue(unsafeProfile);
    repository.listPublicByAccountIds.mockResolvedValue([unsafeProfile]);
  });

  test('restores stable employee profile lookup ports', () => {
    expect(typeof hrPublic.getEmployeeProfileByAccountId).toBe('function');
    expect(typeof hrPublic.getEmployeeProfileByEmployeeCode).toBe('function');
    expect(typeof hrPublic.listEmployeeProfilesByAccountIds).toBe('function');
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
});
