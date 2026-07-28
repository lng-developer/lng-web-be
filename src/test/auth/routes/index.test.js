const http = require('http');
const express = require('express');
const authRouter = require('../../../modules/auth/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const requestContext = require('../../../middlewares/requestContext');
const authManager = require('../../../modules/auth/services/authManager.service');

jest.mock('../../../modules/auth/services/authManager.service');

function createTestServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(requestContext);
  app.use(express.json());
  app.use(authRouter);
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
  });

  test('POST /login regenerates invalid request ids and bounds audit HTTP context', async () => {
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
      ipAddress: '1'.repeat(100),
    });
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
