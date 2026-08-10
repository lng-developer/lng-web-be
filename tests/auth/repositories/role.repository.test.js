const Role = require('../../../src/modules/auth/models/role.model');
const roleRepository = require('../../../src/modules/auth/repositories/role.repository');

jest.mock('../../../src/modules/auth/models/role.model', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
}));

describe('roleRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('addPermission uses addToSet to avoid duplicate permission ids', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'role-id', permissions: ['permission-id'] });
    Role.findByIdAndUpdate.mockReturnValue({ lean });

    await roleRepository.addPermission('role-id', 'permission-id');

    expect(Role.findByIdAndUpdate).toHaveBeenCalledWith(
      'role-id',
      { $addToSet: { permissions: 'permission-id' } },
      { returnDocument: 'after' },
    );
  });

  test('removePermission uses pull to remove one permission id', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'role-id', permissions: [] });
    Role.findByIdAndUpdate.mockReturnValue({ lean });

    await roleRepository.removePermission('role-id', 'permission-id');

    expect(Role.findByIdAndUpdate).toHaveBeenCalledWith(
      'role-id',
      { $pull: { permissions: 'permission-id' } },
      { returnDocument: 'after' },
    );
  });
});
