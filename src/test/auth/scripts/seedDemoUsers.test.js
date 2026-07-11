const { buildDemoUsers, DEMO_PASSWORD } = require('../../../modules/auth/scripts/seedDemoUsers');
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
    });
    expect(usersByEmail.get('j2531@demo.lng.co')).toMatchObject({
      employeeCode: 'J2531',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.SHOP,
      scopeId: '660000000000000000000201',
    });
    expect(usersByEmail.get('j2536@demo.lng.co')).toMatchObject({
      employeeCode: 'J2536',
      roleCode: roleCodes.USER,
      scopeType: accessScopeTypes.SHOP,
      scopeId: '660000000000000000000202',
    });
  });
});
