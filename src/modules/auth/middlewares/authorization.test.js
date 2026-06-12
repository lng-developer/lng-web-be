const {
  authorizePermissions,
  authorizeAnyPermission,
  authorizeRoles,
} = require('./authorization');

function runMiddleware(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (error) => resolve(error));
  });
}

describe('authorization middleware', () => {
  test('authorizePermissions allows requests with all permissions', async () => {
    const error = await runMiddleware(authorizePermissions('ORDERS:READ', 'FINANCE:WRITE'), {
      auth: { permissions: ['ORDERS:READ', 'FINANCE:WRITE'] },
    });

    expect(error).toBeUndefined();
  });

  test('authorizeAnyPermission allows requests with one matching permission', async () => {
    const error = await runMiddleware(authorizeAnyPermission('ORDERS:WRITE', 'ORDERS:READ'), {
      auth: { permissions: ['ORDERS:READ'] },
    });

    expect(error).toBeUndefined();
  });

  test('authorizeRoles rejects missing role with 403', async () => {
    const error = await runMiddleware(authorizeRoles('ADMIN'), {
      auth: { roles: ['OPERATOR'] },
    });

    expect(error).toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });
});
