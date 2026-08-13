const {
  authorizePermissions,
  authorizeScopedPermission,
  canAccessScope,
  authorizeAnyPermission,
  authorizeRoles,
} = require('../../../src/modules/auth/middlewares/authorization');

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

  test('authorizePermissions allows a global SUPER_ADMIN without an explicit permission', async () => {
    const error = await runMiddleware(authorizePermissions('FUTURE_MODULE:WRITE'), {
      auth: { roles: ['SUPER_ADMIN'], permissions: [] },
    });

    expect(error).toBeUndefined();
  });

  test('authorizePermissions rejects permissions that exist only inside scoped assignments', async () => {
    const error = await runMiddleware(authorizePermissions('AUTH:WRITE'), {
      auth: {
        permissions: [],
        scopes: [{
          scopeType: 'department',
          scopeId: 'department-id',
          permissions: ['AUTH:WRITE'],
        }],
      },
    });

    expect(error).toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
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
    const now = new Date();
    expect(canAccessScope(
      {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: 'team-id',
          permissions: ['TEAM_MEMBERS:READ'],
          validFrom: new Date(now.getTime() - 60000),
          validUntil: new Date(now.getTime() + 60000),
        }],
      },
      'TEAM_MEMBERS:READ',
      { scopeType: 'team', scopeId: 'team-id' },
    )).toBe(true);
  });

  test('canAccessScope compares scope ids by string value', () => {
    const objectIdLike = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(canAccessScope(
      {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: objectIdLike,
          permissions: ['TEAM_MEMBERS:READ'],
          validFrom: new Date(Date.now() - 60000),
        }],
      },
      'TEAM_MEMBERS:READ',
      { scopeType: 'team', scopeId: '507f1f77bcf86cd799439011' },
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
            validFrom: new Date(Date.now() - 60000),
            validUntil: new Date(Date.now() + 60000),
          }],
        },
      },
    );

    expect(error).toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });

  test('authorizeScopedPermission allows a global SUPER_ADMIN for every scope', async () => {
    const error = await runMiddleware(
      authorizeScopedPermission('FUTURE_MODULE:READ', () => ({ scopeType: 'shop', scopeId: 'shop-id' })),
      { auth: { roles: ['SUPER_ADMIN'], permissions: [], scopes: [] } },
    );

    expect(error).toBeUndefined();
  });

  test('canAccessScope rejects expired scoped permission window', () => {
    expect(canAccessScope(
      {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: 'team-id',
          permissions: ['TEAM_MEMBERS:READ'],
          validUntil: new Date(Date.now() - 60000),
        }],
      },
      'TEAM_MEMBERS:READ',
      { scopeType: 'team', scopeId: 'team-id' },
    )).toBe(false);
  });

  test('canAccessScope rejects scoped permission before validFrom', () => {
    expect(canAccessScope(
      {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: 'team-id',
          permissions: ['TEAM_MEMBERS:READ'],
          validFrom: new Date(Date.now() + 60000),
        }],
      },
      'TEAM_MEMBERS:READ',
      { scopeType: 'team', scopeId: 'team-id' },
    )).toBe(false);
  });

  test('canAccessScope rejects malformed validity windows', () => {
    expect(canAccessScope(
      {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: 'team-id',
          permissions: ['TEAM_MEMBERS:READ'],
          validUntil: 'not-a-date',
        }],
      },
      'TEAM_MEMBERS:READ',
      { scopeType: 'team', scopeId: 'team-id' },
    )).toBe(false);
  });

  test('authorizeScopedPermission blocks expired scope but allows active scope', async () => {
    const now = new Date();

    const activeError = await runMiddleware(
      authorizeScopedPermission('TEAM_MEMBERS:READ', () => ({ scopeType: 'team', scopeId: 'team-id' })),
      {
        auth: {
          permissions: [],
          scopes: [{
            scopeType: 'team',
            scopeId: 'team-id',
            permissions: ['TEAM_MEMBERS:READ'],
            validFrom: new Date(now.getTime() - 60000),
          }],
        },
      },
    );

    const expiredError = await runMiddleware(
      authorizeScopedPermission('TEAM_MEMBERS:READ', () => ({ scopeType: 'team', scopeId: 'team-id' })),
      {
        auth: {
          permissions: [],
          scopes: [{
            scopeType: 'team',
            scopeId: 'team-id',
            permissions: ['TEAM_MEMBERS:READ'],
            validUntil: new Date(now.getTime() - 60000),
          }],
        },
      },
    );

    expect(activeError).toBeUndefined();
    expect(expiredError).toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });
});
