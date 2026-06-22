const {
  toAccountAdminDto,
  toAccessAssignmentDto,
  toScopeRegistryDto,
  toScopedRolePermissionDto,
} = require('../../../modules/auth/dtos/admin.dto');

describe('admin auth DTOs', () => {
  test('scope registry DTO exposes registry id and resource id aliases', () => {
    const result = toScopeRegistryDto({
      _id: '6a339b58033e2ff7753522b5',
      scopeType: 'shop',
      scopeId: '660000000000000000000201',
      name: 'Football US Shop',
      status: 'active',
    });

    expect(result).toMatchObject({
      id: '6a339b58033e2ff7753522b5',
      scopeRegistryId: '6a339b58033e2ff7753522b5',
      scopeType: 'shop',
      scopeId: '660000000000000000000201',
      resourceId: '660000000000000000000201',
      name: 'Football US Shop',
      status: 'active',
    });
  });

  test('scoped assignment DTOs expose resource id without changing scope id', () => {
    expect(toAccessAssignmentDto({
      _id: '6a339b61033e2ff775352313',
      accountId: '6a339b61033e2ff775352311',
      roleId: '6a339b56033e2ff7753522b1',
      scopeType: 'shop',
      scopeId: '660000000000000000000201',
      customPermissions: [],
      status: 'active',
    })).toMatchObject({
      scopeId: '660000000000000000000201',
      resourceId: '660000000000000000000201',
    });

    expect(toScopedRolePermissionDto({
      _id: '6a339b6d033e2ff775352351',
      scopeType: 'shop',
      scopeId: '660000000000000000000201',
      roleId: '6a339b56033e2ff7753522b1',
      permissions: [],
    })).toMatchObject({
      scopeId: '660000000000000000000201',
      resourceId: '660000000000000000000201',
    });
  });

  test('account admin DTO exposes effective roles and permissions across scopes', () => {
    const result = toAccountAdminDto({
      account: {
        _id: '6a339b5f033e2ff7753522fc',
        email: 'j2524@demo.lng.co',
        status: 'active',
      },
      profile: {
        _id: '6a339b5f033e2ff7753522fd',
        accountId: '6a339b5f033e2ff7753522fc',
        email: 'j2524@demo.lng.co',
        fullName: 'J2524 Design Operator',
      },
      roles: [],
      permissions: [],
      scopes: [{
        assignmentId: '6a339b5f033e2ff7753522fe',
        roleId: '6a339b56033e2ff7753522b1',
        scopeType: 'team',
        scopeId: '660000000000000000000102',
        customPermissionIds: [],
        roles: ['USER'],
        permissions: ['CATALOG:READ', 'ORDERS:READ'],
      }],
    });

    expect(result.roles).toEqual([]);
    expect(result.permissions).toEqual([]);
    expect(result.effectiveRoles).toEqual(['USER']);
    expect(result.effectivePermissions).toEqual(['CATALOG:READ', 'ORDERS:READ']);
  });
});
