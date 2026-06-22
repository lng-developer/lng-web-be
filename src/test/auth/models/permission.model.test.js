const Permission = require('../../../modules/auth/models/permission.model');

describe('Permission model', () => {
  test('defaults optional name to null', () => {
    const permission = new Permission({
      code: 'ORDERS:READ',
    });

    expect(permission.name).toBeNull();
  });

  test('accepts optional description', async () => {
    const permission = new Permission({
      code: 'ORDERS:READ',
      name: 'Read orders',
      description: 'Allows read access for orders.',
    });

    await expect(permission.validate()).resolves.toBeUndefined();
    expect(permission.name).toBe('Read orders');
    expect(permission.description).toBe('Allows read access for orders.');
  });
});
