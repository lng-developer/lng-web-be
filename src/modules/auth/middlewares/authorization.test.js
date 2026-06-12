const {
  authorizePermissions,
  authorizeScopedPermission,
  canAccessScope,
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

  test('canAccessScope allows matching scoped permission', () => {
    expect(canAccessScope(
      {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: 'team-id',
          permissions: ['TEAM_MEMBERS:READ'],
        }],
      },
      'TEAM_MEMBERS:READ',
      { scopeType: 'team', scopeId: 'team-id' },
    )).toBe(true);
  });

  test('canAccessScope allows global permission as scoped override', () => {
    expect(canAccessScope(
      { permissions: ['TEAM_MEMBERS:READ'], scopes: [] },
      'TEAM_MEMBERS:READ',
      { scopeType: 'team', scopeId: 'team-id' },
    )).toBe(true);
  });

  test('authorizeScopedPermission rejects mismatched scope with 403', async () => {
    const error = await runMiddleware(
      authorizeScopedPermission('TEAM_MEMBERS:READ', () => ({ scopeType: 'team', scopeId: 'finance-team' })),
      {
        auth: {
          permissions: [],
          scopes: [{
            scopeType: 'team',
            scopeId: 'sales-team',
            permissions: ['TEAM_MEMBERS:READ'],
          }],
        },
      },
    );

    expect(error).toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });
});
