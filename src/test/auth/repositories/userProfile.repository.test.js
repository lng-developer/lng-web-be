const UserProfile = require('../../../modules/auth/models/userProfile.model');
const userProfileRepository = require('../../../modules/auth/repositories/userProfile.repository');

jest.mock('../../../modules/auth/models/account.model', () => ({
  collection: { name: 'accounts' },
}));

jest.mock('../../../modules/auth/models/accessAssignment.model', () => ({
  collection: { name: 'accessassignments' },
}));

jest.mock('../../../modules/auth/models/permission.model', () => ({
  collection: { name: 'permissions' },
}));

jest.mock('../../../modules/auth/models/role.model', () => ({
  collection: { name: 'roles' },
}));

jest.mock('../../../modules/auth/models/scopedRolePermission.model', () => ({
  collection: { name: 'scopedrolepermissions' },
}));

jest.mock('../../../modules/auth/models/userProfile.model', () => ({
  aggregate: jest.fn(),
}));

describe('userProfileRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('listAssignableProfiles filters by required permission when provided', async () => {
    UserProfile.aggregate.mockResolvedValue([]);

    await userProfileRepository.listAssignableProfiles({
      accountIds: ['660000000000000000000901'],
      search: 'j26',
      limit: 10,
      requiredPermission: 'production:write',
    });

    const pipelineJson = JSON.stringify(UserProfile.aggregate.mock.calls[0][0]);

    expect(pipelineJson).toContain('accessassignments');
    expect(pipelineJson).toContain('scopedrolepermissions');
    expect(pipelineJson).toContain('permissions');
    expect(pipelineJson).toContain('PRODUCTION:WRITE');
    expect(pipelineJson).toContain('assignablePermissionIds');
    expect(pipelineJson).toContain('overridePermissions');
    expect(pipelineJson).toContain('$in');
  });

  test('listAssignableProfiles keeps the old active-account-only query without required permission', async () => {
    UserProfile.aggregate.mockResolvedValue([]);

    await userProfileRepository.listAssignableProfiles({ limit: 25 });

    const pipelineJson = JSON.stringify(UserProfile.aggregate.mock.calls[0][0]);

    expect(pipelineJson).toContain('accounts');
    expect(pipelineJson).not.toContain('assignablePermissionIds');
    expect(pipelineJson).not.toContain('PRODUCTION:WRITE');
  });
});
