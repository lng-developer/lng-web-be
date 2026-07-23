const { permissions, rolePermissions } = require('../../../modules/auth/scripts/seedRbac');
const { roleCodes } = require('../../../modules/auth/constants/auth.constants');

test('seeds SUPER_ADMIN with every current permission', () => {
  expect(rolePermissions[roleCodes.SUPER_ADMIN]).toEqual(permissions);
});
