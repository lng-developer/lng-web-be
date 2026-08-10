const mongoose = require('mongoose');
const ScopedRolePermission = require('../../../src/modules/auth/models/scopedRolePermission.model');

describe('ScopedRolePermission model', () => {
  const scopeId = new mongoose.Types.ObjectId();
  const roleId = new mongoose.Types.ObjectId();
  const permissionId = new mongoose.Types.ObjectId();

  test('requires concrete scoped resource identity', async () => {
    const rule = new ScopedRolePermission({
      scopeType: 'team',
      roleId,
      permissions: [permissionId],
    });

    await expect(rule.validate()).rejects.toThrow('scopeId');
  });

  test('accepts department and team scoped role permission rules', async () => {
    const departmentRule = new ScopedRolePermission({
      scopeType: 'department',
      scopeId,
      roleId,
      permissions: [permissionId],
    });
    const teamRule = new ScopedRolePermission({
      scopeType: 'team',
      scopeId,
      roleId,
      permissions: [permissionId],
    });

    await expect(departmentRule.validate()).resolves.toBeUndefined();
    await expect(teamRule.validate()).resolves.toBeUndefined();
  });

  test('defines unique key for one role override per scope', () => {
    const uniqueIndex = ScopedRolePermission.schema.indexes().find(([fields, options]) => (
      fields.scopeType === 1
      && fields.scopeId === 1
      && fields.roleId === 1
      && options.unique === true
    ));

    expect(uniqueIndex).toBeDefined();
  });
});
