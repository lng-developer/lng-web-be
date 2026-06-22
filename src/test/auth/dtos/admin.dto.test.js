const {
  toRoleDto,
  toPermissionDto,
  toAccountListDto,
  toAccountAdminDto,
  toAccessAssignmentDto,
  toScopeRegistryDto,
  toScopedRolePermissionDto,
} = require('../../../modules/auth/dtos/admin.dto');
const { toProfileDto } = require('../../../modules/auth/dtos/auth.dto');

describe('admin auth DTOs', () => {
  test('role and permission DTOs expose display metadata', () => {
    expect(toRoleDto({
      _id: '6a339b58033e2ff7753522b1',
      name: 'Manager',
      code: 'MANAGER',
      description: 'Manages teams',
      userCount: 2,
      permissions: [],
    })).toMatchObject({
      description: 'Manages teams',
      userCount: 2,
      deletable: false,
    });

    expect(toPermissionDto({
      _id: '6a339b58033e2ff7753522b2',
      code: 'ORDERS:READ',
      name: 'Read orders',
      description: 'Allows read access',
    })).toMatchObject({
      name: 'Read orders',
      description: 'Allows read access',
    });
  });

  test('account list DTO exposes global access for edit modal', () => {
    const result = toAccountListDto({
      _id: '6a339b5f033e2ff7753522fc',
      email: 'admin@example.com',
      status: 'active',
      roleAssignments: [
        {
          assignmentId: 'global-assignment',
          roleId: '6a339b56033e2ff7753522b1',
          roleCode: 'ADMIN',
          scopeType: 'global',
          scopeId: null,
          customPermissionIds: ['6a339b56033e2ff7753522b3'],
        },
      ],
    });

    expect(result.access).toEqual({
      roleIds: ['6a339b56033e2ff7753522b1'],
      customPermissionIds: ['6a339b56033e2ff7753522b3'],
    });
  });

  test('profile DTO exposes personal metadata with null fallback', () => {
    expect(toProfileDto({
      _id: '6a339b5f033e2ff7753522fd',
      accountId: '6a339b5f033e2ff7753522fc',
      email: 'admin@example.com',
      fullName: 'Admin',
    })).toMatchObject({
      phone: null,
      avatarUrl: null,
      personalEmail: null,
      dateOfBirth: null,
      gender: null,
      address: null,
    });
  });

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

  test('account admin DTO does not repeat global assignments in scopes', () => {
    const result = toAccountAdminDto({
      account: {
        _id: '6a339b5f033e2ff7753522fc',
        email: 'admin@example.com',
        status: 'active',
      },
      profile: null,
      roles: ['ADMIN'],
      permissions: ['AUTH:READ'],
      scopes: [
        {
          assignmentId: 'global-assignment',
          roleId: '6a339b56033e2ff7753522b1',
          scopeType: 'global',
          scopeId: null,
          customPermissionIds: [],
          roles: ['ADMIN'],
          permissions: ['AUTH:READ'],
        },
        {
          assignmentId: 'team-assignment',
          roleId: '6a339b56033e2ff7753522b2',
          scopeType: 'team',
          scopeId: '660000000000000000000102',
          customPermissionIds: [],
          roles: ['LEADER'],
          permissions: ['TEAM_MEMBERS:READ'],
        },
      ],
    });

    expect(result.access.roleIds).toEqual(['6a339b56033e2ff7753522b1']);
    expect(result.scopes).toEqual([expect.objectContaining({
      assignmentId: 'team-assignment',
      scopeType: 'team',
    })]);
  });
});
