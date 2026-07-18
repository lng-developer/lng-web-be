const { permissions, rolePermissions } = require('../../modules/auth/scripts/seedRbac');

describe('HR RBAC seed', () => {
  test('includes the Phase 1 HR permissions', () => {
    expect(permissions).toEqual(expect.arrayContaining([
      'HR_EMPLOYEES:READ',
      'HR_EMPLOYEES:WRITE',
      'HR_COMPENSATION:READ',
      'HR_COMPENSATION:WRITE',
    ]));
    expect(rolePermissions.ADMIN).toEqual(expect.arrayContaining([
      'HR_EMPLOYEES:READ',
      'HR_EMPLOYEES:WRITE',
      'HR_COMPENSATION:READ',
      'HR_COMPENSATION:WRITE',
    ]));
    expect(rolePermissions.MANAGER).toContain('HR_EMPLOYEES:READ');
  });

  test('assigns Phase 2 time permissions by role', () => {
    const allTimePermissions = [
      'HR_SCHEDULE:READ',
      'HR_SCHEDULE:WRITE',
      'HR_ATTENDANCE:READ',
      'HR_ATTENDANCE:WRITE',
      'HR_ATTENDANCE:MANAGE',
      'HR_LEAVE:READ',
      'HR_LEAVE:WRITE',
      'HR_LEAVE:APPROVE',
      'HR_OVERTIME:READ',
      'HR_OVERTIME:WRITE',
      'HR_OVERTIME:APPROVE',
    ];

    expect(permissions).toEqual(expect.arrayContaining(allTimePermissions));
    expect(rolePermissions.ADMIN).toEqual(expect.arrayContaining(allTimePermissions));
    expect(rolePermissions.MANAGER).toEqual(expect.arrayContaining([
      'HR_SCHEDULE:READ',
      'HR_ATTENDANCE:READ',
      'HR_LEAVE:READ',
      'HR_LEAVE:APPROVE',
      'HR_OVERTIME:READ',
      'HR_OVERTIME:APPROVE',
    ]));
    expect(rolePermissions.LEADER).toEqual(expect.arrayContaining([
      'HR_SCHEDULE:READ',
      'HR_ATTENDANCE:READ',
      'HR_LEAVE:READ',
      'HR_LEAVE:APPROVE',
      'HR_OVERTIME:READ',
      'HR_OVERTIME:APPROVE',
    ]));
    expect(rolePermissions.USER.filter((code) => code.startsWith('HR_'))).toEqual([
      'HR_ATTENDANCE:WRITE',
      'HR_LEAVE:WRITE',
      'HR_OVERTIME:WRITE',
    ]);
  });
});
