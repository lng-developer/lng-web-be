const {
  buildDemoUsers,
  DEMO_PASSWORD,
  scopedPermissionRules,
} = require('../../../modules/auth/scripts/seedDemoUsers');
const { roleCodes, accessScopeTypes } = require('../../../modules/auth/constants/auth.constants');

describe('seedDemoUsers RBAC matrix', () => {
  test('builds canonical demo accounts for manager leader user scope testing', () => {
    const usersByEmail = new Map(buildDemoUsers().map((user) => [user.email, user]));

    expect(DEMO_PASSWORD).toBe('Demo@123456');
    expect(usersByEmail.get('j2501@demo.lng.co')).toMatchObject({
      employeeCode: 'J2501',
      roleCode: roleCodes.MANAGER,
      scopeType: accessScopeTypes.DEPARTMENT,
      scopeId: '660000000000000000000001',
    });
    expect(usersByEmail.get('j2506@demo.lng.co')).toMatchObject({
      employeeCode: 'J2506',
      roleCode: roleCodes.LEADER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000101',
    });
    expect(usersByEmail.get('j2510@demo.lng.co')).toMatchObject({
      employeeCode: 'J2510',
      roleCode: roleCodes.LEADER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000102',
    });
    expect(usersByEmail.get('j2514@demo.lng.co')).toMatchObject({
      employeeCode: 'J2514',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000101',
    });
    expect(usersByEmail.get('j2523@demo.lng.co')).toMatchObject({
      employeeCode: 'J2523',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000102',
      title: 'Scale Designer',
    });
    expect(usersByEmail.get('j2524@demo.lng.co')).toMatchObject({
      employeeCode: 'J2524',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000102',
      title: 'Design QC Reviewer',
      overridePermissionCodes: expect.arrayContaining(['DESIGN:REVIEW', 'PRODUCTION:WRITE']),
    });
    expect(usersByEmail.get('j2515@demo.lng.co')).toMatchObject({
      employeeCode: 'J2515',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000101',
      title: 'CS Production Coordinator',
      overridePermissionCodes: expect.arrayContaining(['PRODUCTION:WRITE']),
    });
    expect(usersByEmail.get('j2531@demo.lng.co')).toMatchObject({
      employeeCode: 'J2531',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.SHOP,
      scopeId: '660000000000000000000201',
    });
    expect(usersByEmail.get('j2532@demo.lng.co')).toMatchObject({
      employeeCode: 'J2532',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.SHOP,
      scopeId: '660000000000000000000201',
      title: 'Football Scale Designer',
      overridePermissionCodes: expect.arrayContaining(['DESIGN:WORK', 'PRODUCTION:READ']),
    });
    expect(usersByEmail.get('j2533@demo.lng.co')).toMatchObject({
      employeeCode: 'J2533',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.SHOP,
      scopeId: '660000000000000000000201',
      title: 'Football QC Reviewer',
      overridePermissionCodes: expect.arrayContaining(['DESIGN:REVIEW', 'PRODUCTION:READ']),
    });
    expect(usersByEmail.get('j2534@demo.lng.co')).toMatchObject({
      employeeCode: 'J2534',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.SHOP,
      scopeId: '660000000000000000000201',
      title: 'Football Production CS',
      overridePermissionCodes: expect.arrayContaining(['PRODUCTION:WRITE']),
    });
    expect(usersByEmail.get('j2536@demo.lng.co')).toMatchObject({
      employeeCode: 'J2536',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.SHOP,
      scopeId: '660000000000000000000202',
    });
  });

  test('defines tight scoped permission overrides for RBAC boundary testing', () => {
    const byLabel = new Map(scopedPermissionRules.map((rule) => [rule.label, rule]));

    expect(byLabel.get('Sales staff')).toMatchObject({
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000101',
      permissionCodes: expect.arrayContaining(['ORDERS:READ', 'ORDERS:WRITE']),
    });
    expect(byLabel.get('Sales staff').permissionCodes).not.toContain('PRODUCTION:WRITE');

    expect(byLabel.get('Scale designer')).toMatchObject({
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000102',
      permissionCodes: expect.arrayContaining(['DESIGN:WORK', 'PRODUCTION:WRITE']),
    });
    expect(byLabel.get('Scale designer').permissionCodes).not.toContain('DESIGN:REVIEW');

    expect(byLabel.get('Football shop seller')).toMatchObject({
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.SHOP,
      scopeId: '660000000000000000000201',
      permissionCodes: ['ORDERS:READ', 'CATALOG:READ', 'SHOPS:READ'],
    });
  });
});
