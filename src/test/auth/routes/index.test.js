const http = require('http');
const express = require('express');
const authRouter = require('../../../modules/auth/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const requestContext = require('../../../middlewares/requestContext');
const authManager = require('../../../modules/auth/services/authManager.service');
const authAdmin = require('../../../modules/auth/services/authAdmin.service');

jest.mock('../../../modules/auth/services/authManager.service');
jest.mock('../../../modules/auth/services/authAdmin.service');
jest.mock('../../../modules/hr/public', () => ({
  getEmployeeProfileByAccountId: jest.fn(),
}));

const hrPublic = require('../../../modules/hr/public');

function createTestServer() {
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  app.use(authRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function createSetupTestServer() {
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const { port } = server.address();
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        method,
        port,
        path,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      }, (res) => {
        let responseBody = '';

        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          server.close(() => {
            const contentType = res.headers['content-type'] || '';
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: responseBody && contentType.includes('application/json')
                ? JSON.parse(responseBody)
                : responseBody || null,
            });
          });
        });
      });

      req.on('error', (error) => {
        server.close(() => reject(error));
      });

      if (payload) {
        req.write(payload);
      }

      req.end();
    });
  });
}

describe('auth routes', () => {
  const createAccountBody = {
    email: 'new.admin@lng.co',
    password: 'strong-password',
    fullName: 'New Admin',
    assignments: [{
      roleId: '507f1f77bcf86cd799439012',
      scopeType: 'global',
      scopeId: null,
      customPermissionIds: [],
    }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue(null);
  });

  test('PATCH /accounts/:accountId/status passes authenticated actor and HTTP context', async () => {
    const actor = {
      accountId: '507f1f77bcf86cd799439021', roles: ['ADMIN'], permissions: ['AUTH:WRITE'], scopes: [],
    };
    authManager.verifyAccessToken.mockReturnValue({ sub: actor.accountId, tokenVersion: 0 });
    authManager.getCurrentAccount.mockResolvedValue({
      account: { _id: actor.accountId, tokenVersion: 0, status: 'active' },
      roles: actor.roles, permissions: actor.permissions, scopes: [],
    });
    authManager.buildAuthContext.mockReturnValue(actor);
    authAdmin.updateAccountStatus.mockResolvedValue({ id: '507f1f77bcf86cd799439011', status: 'inactive' });

    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: '/accounts/507f1f77bcf86cd799439011/status',
      headers: {
        Authorization: 'Bearer access-token',
        'X-Request-Id': 'admin-request-1',
        'X-Forwarded-For': '10.0.0.5',
        'User-Agent': 'admin-route-test',
      },
      body: { status: 'inactive' },
    });

    expect(response.statusCode).toBe(200);
    expect(authAdmin.updateAccountStatus).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011', 'inactive', actor,
      {
        requestId: 'admin-request-1',
        ipAddress: expect.stringMatching(/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/),
        userAgent: 'admin-route-test',
      },
    );
  });

  test('PATCH /accounts/:accountId/status ignores untrusted forwarded IP and bounds user agent', async () => {
    const actor = {
      accountId: '507f1f77bcf86cd799439021', roles: ['ADMIN'], permissions: ['AUTH:WRITE'], scopes: [],
    };
    authManager.verifyAccessToken.mockReturnValue({ sub: actor.accountId, tokenVersion: 0 });
    authManager.getCurrentAccount.mockResolvedValue({
      account: { _id: actor.accountId, tokenVersion: 0, status: 'active' },
      roles: actor.roles, permissions: actor.permissions, scopes: [],
    });
    authManager.buildAuthContext.mockReturnValue(actor);
    authAdmin.updateAccountStatus.mockResolvedValue({ id: '507f1f77bcf86cd799439011', status: 'inactive' });

    await request(createTestServer(), {
      method: 'PATCH',
      path: '/accounts/507f1f77bcf86cd799439011/status',
      headers: {
        Authorization: 'Bearer access-token',
        'X-Forwarded-For': '1'.repeat(120),
        'User-Agent': ` ${'u'.repeat(550)} `,
      },
      body: { status: 'inactive' },
    });

    expect(authAdmin.updateAccountStatus.mock.calls[0][3]).toMatchObject({
      ipAddress: expect.stringMatching(/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/),
      userAgent: 'u'.repeat(500),
    });
  });

  test('POST /login regenerates request ids, ignores forwarded IP, and bounds user agent', async () => {
    authManager.login.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
    const oversizedRequestId = 'r'.repeat(201);
    const oversizedUserAgent = ` ${'u'.repeat(550)} `;
    const oversizedIp = '1'.repeat(120);

    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/login',
      headers: {
        'X-Request-Id': oversizedRequestId,
        'User-Agent': oversizedUserAgent,
        'X-Forwarded-For': oversizedIp,
      },
      body: { identifier: 'operator@lng.co', password: 'valid-password' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(authManager.login).toHaveBeenCalledWith('operator@lng.co', 'valid-password', {
      requestId: response.headers['x-request-id'],
      userAgent: 'u'.repeat(500),
      ipAddress: expect.stringMatching(/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/),
    });
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([
      expect.stringMatching(/^refreshToken=refresh;/),
      expect.stringContaining('HttpOnly'),
      expect.stringContaining('SameSite=Lax'),
    ]));
    expect(response.body.data).toEqual(expect.objectContaining({
      accessToken: 'access',
      tokenType: 'Bearer',
    }));
    expect(response.body.data.refreshToken).toBeUndefined();
  });

  test('POST /logout revokes the refresh-cookie session without an access token', async () => {
    authManager.logout.mockResolvedValue(undefined);

    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/logout',
      headers: { Cookie: 'refreshToken=refresh-token' },
    });

    expect(response.statusCode).toBe(204);
    expect(authManager.logout).toHaveBeenCalledWith('refresh-token', expect.any(Object));
  });

  test('POST /refresh rotates a refresh-cookie session without a request body', async () => {
    authManager.refreshSession.mockResolvedValue({ accessToken: 'next-access', refreshToken: 'next-refresh' });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/refresh',
      headers: { Cookie: 'refreshToken=previous-refresh' },
    });

    expect(response.statusCode).toBe(200);
    expect(authManager.refreshSession).toHaveBeenCalledWith('previous-refresh', expect.any(Object));
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([
      expect.stringMatching(/^refreshToken=next-refresh;/),
    ]));
    expect(response.body.data.refreshToken).toBeUndefined();
  });

  test('POST /refresh does not rate limit local session restoration', async () => {
    authManager.refreshSession.mockResolvedValue({ accessToken: 'next-access', refreshToken: 'next-refresh' });
    const responses = [];

    for (let attempt = 0; attempt < 31; attempt += 1) {
      responses.push(await request(createTestServer(), {
        method: 'POST',
        path: '/refresh',
        headers: { Cookie: 'refreshToken=previous-refresh' },
      }));
    }

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
  });

  test('POST /logout rejects a request with no refresh token', async () => {
    const response = await request(createTestServer(), { method: 'POST', path: '/logout' });

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST /accounts rejects missing bearer token', async () => {
    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/accounts',
      body: createAccountBody,
    });

    expect(response.statusCode).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  test('POST /accounts rejects tokens without AUTH:WRITE', async () => {
    authManager.verifyAccessToken.mockReturnValue({ sub: 'account-id', tokenVersion: 0 });
    authManager.getCurrentAccount.mockResolvedValue({
      account: { _id: 'account-id', email: 'operator@lng.co', tokenVersion: 0, status: 'active' },
      roles: ['OPERATOR'],
      permissions: ['AUTH:READ'],
      scopes: [],
    });
    authManager.buildAuthContext.mockReturnValue({
      accountId: 'account-id',
      email: 'operator@lng.co',
      roles: ['OPERATOR'],
      permissions: ['AUTH:READ'],
      scopes: [],
    });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/accounts',
      headers: { Authorization: 'Bearer access-token' },
      body: createAccountBody,
    });

    expect(response.statusCode).toBe(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  test('PATCH /accounts/:accountId/password rejects missing bearer token', async () => {
    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: '/accounts/507f1f77bcf86cd799439011/password',
      body: { password: 'new-strong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  test('POST /me/change-password rejects missing bearer token', async () => {
    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/me/change-password',
      body: { currentPassword: 'old-password', newPassword: 'new-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  test('blocks business access until initial password and profile completion are both finished', async () => {
    const actor = {
      accountId: '507f1f77bcf86cd799439021',
      roles: ['OPERATOR'],
      permissions: ['AUTH:READ'],
      scopes: [],
      mustChangePassword: true,
    };
    authManager.verifyAccessToken.mockReturnValue({ sub: actor.accountId, tokenVersion: 0 });
    authManager.getCurrentAccount.mockResolvedValue({
      account: {
        _id: actor.accountId,
        tokenVersion: 0,
        status: 'active',
        mustChangePassword: true,
        passwordHash: 'secret-hash',
        passwordSalt: 'secret-salt',
      },
      roles: actor.roles,
      permissions: actor.permissions,
      scopes: [],
    });
    authManager.buildAuthContext.mockReturnValue(actor);
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue({ isProfileUpdated: false });

    const blocked = await request(createSetupTestServer(), {
      method: 'GET',
      path: '/api/auth/accounts',
      headers: { Authorization: 'Bearer access-token' },
    });
    const safeState = await request(createSetupTestServer(), {
      method: 'GET',
      path: '/api/auth/me',
      headers: { Authorization: 'Bearer access-token' },
    });
    const allowed = await request(createSetupTestServer(), {
      method: 'POST',
      path: '/api/auth/me/change-password',
      headers: { Authorization: 'Bearer access-token' },
      body: { currentPassword: 'old-password', newPassword: 'new-password' },
    });

    expect(blocked.statusCode).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_SETUP_REQUIRED');
    expect(safeState.statusCode).toBe(200);
    expect(safeState.body.data).toMatchObject({ profileSetupRequired: true });
    expect(safeState.body.data).not.toHaveProperty('profile');
    expect(safeState.body.data.account.passwordHash).toBeUndefined();
    expect(safeState.body.data.account.passwordSalt).toBeUndefined();
    expect(allowed.statusCode).toBe(200);
    expect(authManager.changeOwnPassword).toHaveBeenCalledWith(
      actor.accountId,
      { currentPassword: 'old-password', newPassword: 'new-password' },
      expect.any(Object),
    );
  });

  test('PUT /scoped-role-permissions rejects missing bearer token', async () => {
    const response = await request(createTestServer(), {
      method: 'PUT',
      path: '/scoped-role-permissions',
      body: {
        scopeType: 'team',
        scopeId: '507f1f77bcf86cd799439088',
        roleId: '507f1f77bcf86cd799439012',
        permissionIds: ['507f1f77bcf86cd799439013'],
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  test('PUT /department-role-permissions is not mounted after scoped role permission migration', async () => {
    const response = await request(createTestServer(), {
      method: 'PUT',
      path: '/department-role-permissions',
      body: {
        departmentId: '507f1f77bcf86cd799439088',
        roleId: '507f1f77bcf86cd799439012',
        permissionIds: ['507f1f77bcf86cd799439013'],
      },
    });

    expect(response.statusCode).toBe(404);
  });

  test('POST /accounts/:accountId/revoke-sessions rejects missing bearer token', async () => {
    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/accounts/507f1f77bcf86cd799439011/revoke-sessions',
    });

    expect(response.statusCode).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  test('POST /accounts/:accountId/revoke-sessions rejects tokens without AUTH:WRITE', async () => {
    authManager.verifyAccessToken.mockReturnValue({ sub: 'account-id', tokenVersion: 0 });
    authManager.getCurrentAccount.mockResolvedValue({
      account: { _id: 'account-id', email: 'operator@lng.co', tokenVersion: 0, status: 'active' },
      roles: ['OPERATOR'],
      permissions: ['AUTH:READ'],
      scopes: [],
    });
    authManager.buildAuthContext.mockReturnValue({
      accountId: 'account-id',
      email: 'operator@lng.co',
      roles: ['OPERATOR'],
      permissions: ['AUTH:READ'],
      scopes: [],
    });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/accounts/507f1f77bcf86cd799439011/revoke-sessions',
      headers: { Authorization: 'Bearer access-token' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
  });
});
