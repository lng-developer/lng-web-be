const {
  buildDemoUsers,
  DEMO_PASSWORD,
  getDemoRoleCodes,
  getSeedRoleCodes,
  scopedPermissionRules,
} = require('../../../src/modules/auth/scripts/seedDemoUsers');
const { roleCodes, accessScopeTypes } = require('../../../src/modules/auth/constants/auth.constants');

describe('seedDemoUsers RBAC matrix', () => {
  test('loads every specialized role used by demo accounts', () => {
    expect(getDemoRoleCodes()).toEqual(expect.arrayContaining([
      roleCodes.SALES_LEADER,
      roleCodes.DESIGN_LEADER,
      roleCodes.SCALE_LEADER,
      roleCodes.SCALE_OPERATOR,
      roleCodes.QC_REVIEWER,
    ]));
  });

  test('also loads every role referenced by scoped permission rules', () => {
    expect(getSeedRoleCodes()).toEqual(expect.arrayContaining([
      roleCodes.LEADER,
      roleCodes.USER,
    ]));
  });

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
      roleCode: roleCodes.SALES_LEADER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000101',
    });
    expect(usersByEmail.get('j2510@demo.lng.co')).toMatchObject({
      employeeCode: 'J2510',
      roleCode: roleCodes.DESIGN_LEADER,
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
      roleCode: roleCodes.SCALE_OPERATOR,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000102',
      title: 'Scale Designer',
    });
    expect(usersByEmail.get('j2524@demo.lng.co')).toMatchObject({
      employeeCode: 'J2524',
      roleCode: roleCodes.QC_REVIEWER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000102',
      title: 'Design QC Reviewer',
    });
    expect(usersByEmail.get('j2524@demo.lng.co')).not.toHaveProperty('overridePermissionCodes');
    expect(usersByEmail.get('j2515@demo.lng.co')).toMatchObject({
      employeeCode: 'J2515',
      roleCode: roleCodes.SCALE_LEADER,
      scopeType: accessScopeTypes.TEAM,
      scopeId: '660000000000000000000102',
      title: 'CS Production Coordinator',
    });
    expect(usersByEmail.get('j2515@demo.lng.co')).not.toHaveProperty('overridePermissionCodes');
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
    expect(byLabel.get('Scale designer').permissionCodes).not.toContain('WORK_SCORES:ADJUST');

    expect(byLabel.get('Design QC lead').permissionCodes).toEqual(expect.arrayContaining([
      'WORK_SCORES:READ',
      'WORK_SCORES:ADJUST',
    ]));

    expect(byLabel.get('Football shop seller')).toMatchObject({
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.SHOP,
      scopeId: '660000000000000000000201',
      permissionCodes: ['ORDERS:READ', 'CATALOG:READ', 'SHOPS:READ'],
    });
  });

  test('covers every employee required by the organization demo seed', () => {
    const usersByCode = new Map(buildDemoUsers().map((user) => [user.employeeCode, user]));
    const ranges = [
      [2506, 2509, accessScopeTypes.TEAM, '660000000000000000000101'],
      [2510, 2513, accessScopeTypes.TEAM, '660000000000000000000102'],
      [2514, 2514, accessScopeTypes.TEAM, '660000000000000000000101'],
      [2515, 2515, accessScopeTypes.TEAM, '660000000000000000000102'],
      [2516, 2522, accessScopeTypes.TEAM, '660000000000000000000101'],
      [2523, 2530, accessScopeTypes.TEAM, '660000000000000000000102'],
    ];

    for (const [from, to, scopeType, scopeId] of ranges) {
      for (let code = from; code <= to; code += 1) {
        expect(usersByCode.get(`J${code}`)).toMatchObject({ scopeType, scopeId });
      }
    }

    expect(usersByCode.get('J2507')).toMatchObject({ roleCode: roleCodes.USER, title: 'Sales Team Member' });
    expect(usersByCode.get('J2525')).toMatchObject({ roleCode: roleCodes.DESIGNER, title: 'Design Team Member' });
  });
});
