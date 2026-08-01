const persistedPermissions = [];
const persistedRoles = [];

jest.mock('../../../config/database', () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../../../modules/auth/models/permission.model', () => ({
  findOneAndUpdate: jest.fn((filter) => ({
    lean: async () => {
      persistedPermissions.push(filter.code);
      return { _id: `permission:${filter.code}`, code: filter.code };
    },
  })),
}));
jest.mock('../../../modules/auth/models/role.model', () => ({
  findOneAndUpdate: jest.fn((filter, update) => ({
    lean: async () => {
      persistedRoles.push({ code: filter.code, permissions: update.$set.permissions });
      return {};
    },
  })),
}));

const { permissions, rolePermissions, seedRbac } = require('../../../modules/auth/scripts/seedRbac');
const { roleCodes } = require('../../../modules/auth/constants/auth.constants');

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

test('registers Work Score permissions without granting adjustment to users', () => {
  expect(permissions).toEqual(expect.arrayContaining(['WORK_SCORES:READ', 'WORK_SCORES:ADJUST']));
  expect(rolePermissions[roleCodes.MANAGER]).toEqual(expect.arrayContaining(['WORK_SCORES:READ', 'WORK_SCORES:ADJUST']));
  expect(rolePermissions[roleCodes.LEADER]).toEqual(expect.arrayContaining(['WORK_SCORES:READ', 'WORK_SCORES:ADJUST']));
  expect(rolePermissions[roleCodes.USER]).not.toContain('WORK_SCORES:ADJUST');
});

test('persists each required HR foundation permission exactly once', async () => {
  persistedPermissions.length = 0;
  persistedRoles.length = 0;

  await seedRbac();

  expect(persistedPermissions.filter((code) => requiredHrPermissions.includes(code)).sort())
    .toEqual([...requiredHrPermissions].sort());
});

test('grants calendar read to schedule readers while retaining writes for admins', async () => {
  persistedPermissions.length = 0;
  persistedRoles.length = 0;
  await seedRbac();

  const manager = persistedRoles.find((role) => role.code === roleCodes.MANAGER);
  const leader = persistedRoles.find((role) => role.code === roleCodes.LEADER);
  expect(manager.permissions).toContain('permission:HR_CALENDAR:READ');
  expect(leader.permissions).toContain('permission:HR_CALENDAR:READ');
  expect(manager.permissions).not.toContain('permission:HR_CALENDAR:WRITE');
  expect(leader.permissions).not.toContain('permission:HR_CALENDAR:WRITE');
});
