const Role = require('../../../src/modules/auth/models/role.model');

describe('Role model', () => {
  test('defaults optional description to null', () => {
    const role = new Role({
      code: 'MANAGER',
      name: 'Manager',
    });

    expect(role.description).toBeNull();
  });
});
