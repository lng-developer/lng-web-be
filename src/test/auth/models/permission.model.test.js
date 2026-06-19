const Permission = require('../../../modules/auth/models/permission.model');

describe('Permission model', () => {
  test('accepts optional description', async () => {
    const permission = new Permission({
      code: 'ORDERS:READ',
      description: 'Allows read access for orders.',
    });

    await expect(permission.validate()).resolves.toBeUndefined();
    expect(permission.description).toBe('Allows read access for orders.');
  });
});
