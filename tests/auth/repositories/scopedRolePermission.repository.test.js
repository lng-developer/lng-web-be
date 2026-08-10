const ScopedRolePermission = require('../../../src/modules/auth/models/scopedRolePermission.model');
const scopedRolePermissionRepository = require('../../../src/modules/auth/repositories/scopedRolePermission.repository');

jest.mock('../../../src/modules/auth/models/scopedRolePermission.model', () => ({
  findOneAndUpdate: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

describe('scopedRolePermissionRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('upsert stores role permission override by scope type, scope id, and role', async () => {
    const scopeId = '660000000000000000000101';
    const roleId = '507f1f77bcf86cd799439012';
    const permissionId = '507f1f77bcf86cd799439013';
    const toObject = jest.fn().mockReturnValue({
      _id: '660000000000000000000301',
      scopeType: 'team',
      scopeId,
      roleId,
      permissions: [permissionId],
    });
    ScopedRolePermission.findOneAndUpdate.mockResolvedValue({ toObject });

    const result = await scopedRolePermissionRepository.upsert({
      scopeType: 'team',
      scopeId,
      roleId,
      permissions: [permissionId],
    });

    expect(ScopedRolePermission.findOneAndUpdate).toHaveBeenCalledWith(
      { scopeType: 'team', scopeId, roleId },
      {
        $set: { permissions: [permissionId] },
        $setOnInsert: { scopeType: 'team', scopeId, roleId },
      },
      {
        returnDocument: 'after',
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
    expect(result).toMatchObject({ scopeType: 'team', scopeId, roleId });
  });

  test('list filters by scope type, scope id, and role using lean pagination', async () => {
    const lean = jest.fn().mockResolvedValue([{ _id: 'rule-id' }]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    ScopedRolePermission.find.mockReturnValue({ sort });
    ScopedRolePermission.countDocuments.mockResolvedValue(1);

    const result = await scopedRolePermissionRepository.list({
      scopeType: 'team',
      scopeId: '660000000000000000000101',
      roleId: '507f1f77bcf86cd799439012',
      page: 2,
      limit: 10,
    });

    expect(ScopedRolePermission.find).toHaveBeenCalledWith({
      scopeType: 'team',
      scopeId: '660000000000000000000101',
      roleId: '507f1f77bcf86cd799439012',
    });
    expect(skip).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      items: [{ _id: 'rule-id' }],
      total: 1,
      page: 2,
      limit: 10,
    });
  });
});
