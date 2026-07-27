const persistedPermissions = [];

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
  findOneAndUpdate: jest.fn(() => ({ lean: async () => ({}) })),
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

test('persists each required HR foundation permission exactly once', async () => {
  persistedPermissions.length = 0;

  await seedRbac();

  expect(persistedPermissions.filter((code) => requiredHrPermissions.includes(code)).sort())
    .toEqual([...requiredHrPermissions].sort());
});
