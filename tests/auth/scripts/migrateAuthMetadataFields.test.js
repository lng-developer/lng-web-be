const Role = require('../../../src/modules/auth/models/role.model');
const Permission = require('../../../src/modules/auth/models/permission.model');
const Account = require('../../../src/modules/auth/models/account.model');
const {
  buildPermissionName,
  buildRoleDescription,
  migrateAuthMetadataFields,
} = require('../../../src/modules/auth/scripts/migrateAuthMetadataFields');

jest.mock('../../../src/modules/auth/models/role.model');
jest.mock('../../../src/modules/auth/models/permission.model');
jest.mock('../../../src/modules/auth/models/account.model');

function mockFindLean(model, docs) {
  const lean = jest.fn().mockResolvedValue(docs);
  const select = jest.fn(() => ({ lean }));

  model.find.mockReturnValue({ select });
}

describe('migrateAuthMetadataFields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Role.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
    Permission.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
    Account.updateMany.mockResolvedValue({ modifiedCount: 2 });
  });

  test('builds display metadata from existing codes', () => {
    expect(buildPermissionName('ORDERS:READ')).toBe('Read Orders');
    expect(buildRoleDescription({ code: 'MANAGER', name: 'Manager' })).toBe('Manager role.');
  });

  test('backfills display metadata and removes duplicated auth fields', async () => {
    mockFindLean(Role, [{ _id: 'role-id', code: 'MANAGER', name: 'Manager' }]);
    mockFindLean(Permission, [{ _id: 'permission-id', code: 'ORDERS:READ' }]);

    const result = await migrateAuthMetadataFields();

    expect(Role.bulkWrite).toHaveBeenCalledWith([{
      updateOne: {
        filter: { _id: 'role-id' },
        update: { $set: { description: 'Manager role.' } },
      },
    }]);
    expect(Permission.bulkWrite).toHaveBeenCalledWith([{
      updateOne: {
        filter: { _id: 'permission-id' },
        update: { $set: { name: 'Read Orders' } },
      },
    }]);
    expect(Account.updateMany).toHaveBeenCalledWith({}, { $unset: { normalizedEmail: '' } });
    expect(result).toMatchObject({
      roles: { scanned: 1, updated: 1 },
      permissions: { scanned: 1, updated: 1 },
      accounts: { updated: 2 },
    });
  });
});
