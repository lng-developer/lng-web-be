const {
  toRoleDto,
  toPermissionDto,
  toAccountListDto,
  toAccountAdminDto,
  toAccessAssignmentDto,
  toScopeRegistryDto,
  toScopedRolePermissionDto,
} = require('../../../src/modules/auth/dtos/admin.dto');

describe('admin auth DTOs', () => {
  test('role and permission DTOs expose display metadata', () => {
    expect(toRoleDto({
      _id: '6a339b58033e2ff7753522b1',
      name: 'Manager',
      code: 'MANAGER',
      description: 'Manages teams',
      userCount: 2,
      permissions: ['6a339b58033e2ff7753522b2'],
      permissionDetails: [{
        _id: '6a339b58033e2ff7753522b2',
        code: 'ORDERS:READ',
        name: 'Read orders',
      }],
    })).toMatchObject({
      description: 'Manages teams',
      userCount: 2,
      deletable: false,
      permissionCount: 1,
      permissionDetails: [expect.objectContaining({
        code: 'ORDERS:READ',
        module: 'ORDERS',
        action: 'READ',
      })],
    });

    expect(toPermissionDto({
      _id: '6a339b58033e2ff7753522b2',
      code: 'ORDERS:READ',
      name: 'Read orders',
      description: 'Allows read access',
      roleCount: 3,
      usageCount: 4,
      deletable: false,
    })).toMatchObject({
      name: 'Read orders',
      description: 'Allows read access',
      module: 'ORDERS',
      action: 'READ',
      status: 'active',
      roleCount: 3,
      usageCount: 4,
      deletable: false,
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
      validFrom: new Date('2026-01-02T10:00:00.000Z'),
      validUntil: new Date('2026-01-02T11:00:00.000Z'),
    })).toMatchObject({
      scopeId: '660000000000000000000201',
      resourceId: '660000000000000000000201',
      validFrom: new Date('2026-01-02T10:00:00.000Z'),
      validUntil: new Date('2026-01-02T11:00:00.000Z'),
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
      roles: [],
      permissions: [],
      scopes: [{
        assignmentId: '6a339b5f033e2ff7753522fe',
        roleId: '6a339b56033e2ff7753522b1',
        scopeType: 'team',
        scopeId: '660000000000000000000102',
        customPermissionIds: [],
        overridePermissionIds: ['6a339b56033e2ff7753522b4'],
        inheritedPermissionIds: ['6a339b56033e2ff7753522b2'],
        effectivePermissionIds: ['6a339b56033e2ff7753522b4'],
        isPermissionOverridden: true,
        roles: ['USER'],
        permissions: ['ORDERS:READ'],
      }],
    });

    expect(result.roles).toEqual([]);
    expect(result.permissions).toEqual([]);
    expect(result.effectiveRoles).toEqual(['USER']);
    expect(result.effectivePermissions).toEqual(['ORDERS:READ']);
    expect(result.scopes[0]).toMatchObject({
      overridePermissionIds: ['6a339b56033e2ff7753522b4'],
      inheritedPermissionIds: ['6a339b56033e2ff7753522b2'],
      effectivePermissionIds: ['6a339b56033e2ff7753522b4'],
      isPermissionOverridden: true,
    });
  });

  test('account admin DTO does not repeat global assignments in scopes', () => {
    const result = toAccountAdminDto({
      account: {
        _id: '6a339b5f033e2ff7753522fc',
        email: 'admin@example.com',
        status: 'active',
      },
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
