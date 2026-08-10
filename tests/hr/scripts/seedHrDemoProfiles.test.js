const {
  buildProfileOperations,
  seedHrDemoProfiles,
} = require('../../../tools/scripts/seed/seedHrDemoProfiles');

const users = [
  {
    email: 'j2501@demo.lng.co',
    employeeCode: 'J2501',
    fullName: 'J2501 Operations Department Manager',
    title: 'Operations Department Manager',
  },
];
const accounts = [{ _id: 'account-1', email: 'j2501@demo.lng.co' }];

describe('seedHrDemoProfiles', () => {
  test('builds idempotent, non-sensitive HR profile upserts from demo accounts', () => {
    expect(buildProfileOperations(users, accounts)).toEqual([{
      updateOne: {
        filter: { accountId: 'account-1' },
        update: {
          $set: {
            accountId: 'account-1',
            employeeCode: 'J2501',
            fullName: 'J2501 Operations Department Manager',
            jobTitle: 'Operations Department Manager',
            workEmail: 'j2501@demo.lng.co',
            status: 'ACTIVE',
            employmentType: 'FULL_TIME',
            workMode: 'ONSITE',
            isDeleted: false,
            deletedAt: null,
          },
        },
        upsert: true,
      },
    }]);
  });

  test('fails before writing when an expected demo account is missing', async () => {
    const writeProfiles = jest.fn();

    await expect(seedHrDemoProfiles({
      users,
      findAccounts: async () => [],
      writeProfiles,
    })).rejects.toThrow('Missing demo Account for j2501@demo.lng.co');
    expect(writeProfiles).not.toHaveBeenCalled();
  });

  test('writes the mapped upserts once', async () => {
    const writeProfiles = jest.fn(async () => ({ upsertedCount: 1, modifiedCount: 0 }));

    await expect(seedHrDemoProfiles({
      users,
      findAccounts: async () => accounts,
      writeProfiles,
    })).resolves.toEqual({ profiles: 1, upserted: 1, modified: 0 });
    expect(writeProfiles).toHaveBeenCalledWith(buildProfileOperations(users, accounts));
  });
});
