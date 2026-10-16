const persistedPermissions = [];
const persistedRoles = [];

jest.mock('../../../src/config/database', () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));
jest.mock('../../../src/shared/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/modules/auth/models/permission.model', () => ({
  findOneAndUpdate: jest.fn((filter) => ({
    lean: async () => {
      persistedPermissions.push(filter.code);
      return { _id: `permission:${filter.code}`, code: filter.code };
    },
  })),
}));
jest.mock('../../../src/modules/auth/models/role.model', () => ({
  findOneAndUpdate: jest.fn((filter, update) => ({
    lean: async () => {
      persistedRoles.push({ code: filter.code, permissions: update.$set.permissions });
      return {};
    },
  })),
}));

const { permissions, rolePermissions, seedRbac } = require('../../../src/modules/auth/scripts/seedRbac');
const { roleCodes } = require('../../../src/modules/auth/constants/auth.constants');

const requiredHrPermissions = [
  'HR_CALENDAR:READ',
  'HR_CALENDAR:WRITE',
  'HR_PAYROLL:READ',
  'HR_PAYROLL:WRITE',
  'HR_PAYROLL:FINALIZE',
  'HR_PAYROLL:PAY',
  'HR_ANNOUNCEMENTS:READ',
  'HR_ANNOUNCEMENTS:WRITE',
  'HR_INTEGRATIONS:MANAGE',
];

test('seeds SUPER_ADMIN with every current permission', () => {
  expect(rolePermissions[roleCodes.SUPER_ADMIN]).toEqual(permissions);
});

test('registers the narrow PSD requester permission for Sales roles', () => {
  expect(permissions).toContain('DESIGN:PSD_REQUEST');
  expect(rolePermissions[roleCodes.SALES]).toEqual(expect.arrayContaining([
    'CATALOG:READ',
    'CATALOG:WRITE',
    'DESIGN:PSD_REQUEST',
  ]));
  expect(rolePermissions[roleCodes.SALES_LEADER]).toEqual(expect.arrayContaining([
    'CATALOG:READ',
    'CATALOG:WRITE',
    'DESIGN:PSD_REQUEST',
  ]));
  expect(rolePermissions[roleCodes.SALES]).not.toEqual(expect.arrayContaining([
    'DESIGN:READ',
    'DESIGN:WRITE',
    'DESIGN:WORK',
    'DESIGN:REVIEW',
  ]));
});

test('registers Work Score permissions without granting adjustment to users', () => {
  expect(permissions).toEqual(expect.arrayContaining(['WORK_SCORES:READ', 'WORK_SCORES:ADJUST']));
  expect(rolePermissions[roleCodes.MANAGER]).toEqual(expect.arrayContaining(['WORK_SCORES:READ', 'WORK_SCORES:ADJUST']));
  expect(rolePermissions[roleCodes.LEADER]).not.toContain('WORK_SCORES:ADJUST');
  expect(rolePermissions[roleCodes.USER]).not.toContain('WORK_SCORES:ADJUST');
});

test('registers department/team scoped operating roles', () => {
  expect(rolePermissions[roleCodes.DESIGNER]).toEqual(expect.arrayContaining(['DESIGN:WORK', 'DESIGN:READ']));
  expect(rolePermissions[roleCodes.CS_OPERATOR]).toEqual(expect.arrayContaining(['ORDERS:READ', 'ORDERS:WRITE']));
  expect(rolePermissions[roleCodes.SALES_LEADER]).toEqual(expect.arrayContaining([
    'ORDERS:READ',
    'ORDERS:WRITE',
    'ORDERS:ASSIGN',
    'ORDERS:CASE_MANAGE',
  ]));
  expect(rolePermissions[roleCodes.DESIGN_LEADER]).not.toEqual(expect.arrayContaining([
    'DESIGN:REQUEST_READ',
    'DESIGN:REQUEST_ASSIGN',
    'DESIGN:REQUEST_WORK',
  ]));
  expect(rolePermissions[roleCodes.DESIGNER]).not.toEqual(expect.arrayContaining([
    'DESIGN:REQUEST_READ',
    'DESIGN:REQUEST_WORK',
  ]));
  expect(rolePermissions[roleCodes.LEADER]).not.toEqual(expect.arrayContaining(['ORDERS:WRITE']));
  expect(rolePermissions[roleCodes.USER]).not.toEqual(expect.arrayContaining(['ORDERS:WRITE']));
  expect(rolePermissions[roleCodes.DESIGNER]).not.toEqual(expect.arrayContaining(['ORDERS:READ']));
  expect(rolePermissions[roleCodes.LEADER]).not.toEqual(expect.arrayContaining([
    'DESIGN:READ',
    'DESIGN:WRITE',
    'DESIGN:WORK',
    'DESIGN:REVIEW',
    'PRODUCTION:WRITE',
    'SHIPMENTS:WRITE',
    'VENDOR_SUBMISSIONS:WRITE',
  ]));
  expect(rolePermissions[roleCodes.USER]).not.toEqual(expect.arrayContaining([
    'PRODUCTION:WRITE',
    'SHIPMENTS:WRITE',
    'VENDOR_SUBMISSIONS:WRITE',
  ]));
  expect(rolePermissions[roleCodes.FULFILLMENT_OPERATOR]).toEqual(expect.arrayContaining(['SHIPMENTS:WRITE', 'VENDOR_SUBMISSIONS:WRITE']));
  expect(rolePermissions[roleCodes.TEAM_LEADER]).toContain('REPORTS:READ');
  expect(rolePermissions[roleCodes.TEAM_LEADER]).not.toContain('TEAMS:READ');
  expect(rolePermissions[roleCodes.TEAM_LEADER]).not.toContain('TEAMS:WRITE');
  expect(rolePermissions[roleCodes.STAFF_VIEWER]).toEqual(['CATALOG:READ', 'MEDIA:READ']);
});

test('separates scale work, scale assignment, and QC review from production administration', () => {
  expect(rolePermissions[roleCodes.DESIGN_LEADER]).toContain('PRODUCTION:SCALE_ASSIGN');
  expect(rolePermissions[roleCodes.DESIGN_LEADER]).not.toContain('PRODUCTION:WRITE');
  expect(permissions).toEqual(expect.arrayContaining([
    'PRODUCTION:SCALE_WORK',
    'PRODUCTION:SCALE_ASSIGN',
    'PRODUCTION:QC_REVIEW',
  ]));
  expect(rolePermissions[roleCodes.SCALE_OPERATOR]).toEqual(expect.arrayContaining([
    'PRODUCTION:READ',
    'PRODUCTION:SCALE_WORK',
  ]));
  expect(rolePermissions[roleCodes.SCALE_OPERATOR]).not.toContain('PRODUCTION:WRITE');
  expect(rolePermissions[roleCodes.SCALE_LEADER]).toEqual(expect.arrayContaining([
    'PRODUCTION:READ',
    'PRODUCTION:SCALE_WORK',
    'PRODUCTION:SCALE_ASSIGN',
  ]));
  expect(rolePermissions[roleCodes.SCALE_LEADER]).not.toContain('PRODUCTION:WRITE');
  expect(rolePermissions[roleCodes.QC_REVIEWER]).toEqual(expect.arrayContaining([
    'PRODUCTION:QC_REVIEW',
  ]));
});

test('persists each required HR foundation permission exactly once', async () => {
  persistedPermissions.length = 0;
  persistedRoles.length = 0;

  await seedRbac();

  expect(persistedPermissions.filter((code) => requiredHrPermissions.includes(code)).sort())
    .toEqual([...requiredHrPermissions].sort());
});

test('grants leaders HR visibility without calendar or schedule administration', async () => {
  persistedPermissions.length = 0;
  persistedRoles.length = 0;
  await seedRbac();

  const manager = persistedRoles.find((role) => role.code === roleCodes.MANAGER);
  const leader = persistedRoles.find((role) => role.code === roleCodes.LEADER);
  expect(manager.permissions).toContain('permission:HR_CALENDAR:READ');
  expect(leader.permissions).toContain('permission:HR_CALENDAR:READ');
  expect(leader.permissions).not.toContain('permission:HR_CALENDAR:WRITE');
  expect(manager.permissions).not.toContain('permission:HR_CALENDAR:WRITE');
  expect(leader.permissions).not.toContain('permission:HR_SCHEDULE:WRITE');
});

test('leader grants allow team HR but not Portal access; Sales retains team reports', () => {
  const { canAccessScope, authorizeAnyPermission } = require('../../../src/modules/auth/middlewares/authorization');
  const ctx = { permissions: [], scopes: [{ scopeType: 'team', scopeId: 'design-team', permissions: rolePermissions.LEADER }] };
  expect(canAccessScope(ctx, 'HR_LEAVE:APPROVE', { scopeType: 'team', scopeId: 'design-team' })).toBe(true);
  expect(canAccessScope(ctx, 'HR_LEAVE:APPROVE', { scopeType: 'team', scopeId: 'other-team' })).toBe(false);
  for (const permission of ['CATALOG:READ', 'MAPPING:READ', 'MEDIA:READ', 'PRODUCTION:READ', 'SHOPS:READ', 'VENDORS:READ', 'REPORTS:READ', 'HR_CALENDAR:WRITE', 'HR_PAYROLL:READ']) {
    const next = jest.fn();
    authorizeAnyPermission(permission)({ auth: ctx }, {}, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  }
  expect(canAccessScope({ permissions: [], scopes: [{ scopeType: 'team', scopeId: 'sales-team', permissions: rolePermissions.SALES_LEADER }] }, 'REPORTS:READ', { scopeType: 'team', scopeId: 'sales-team' })).toBe(true);
});

test('grants scoped leaders request decision permissions', () => {
  expect(rolePermissions[roleCodes.LEADER]).toEqual(expect.arrayContaining([
    'HR_LEAVE:APPROVE',
    'HR_OVERTIME:APPROVE',
  ]));
});
