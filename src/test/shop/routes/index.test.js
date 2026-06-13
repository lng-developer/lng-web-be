const http = require('http');
const express = require('express');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const shopRouter = require('../../../modules/shop/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const shopService = require('../../../modules/shop/services/shop.service');

jest.mock('../../../modules/shop/services/shop.service');

jest.mock('../../../modules/auth/public', () => {
  const AppErrorMock = require('../../../shared/errors/appError');
  const httpStatusMock = require('../../../shared/constants/httpStatus');
  const errorCodesMock = require('../../../shared/constants/errorCodes');

  function canAccessScope(authContext, permission, scope) {
    if ((authContext.permissions || []).includes(permission)) {
      return true;
    }

    return (authContext.scopes || []).some((grantedScope) => (
      grantedScope.scopeType === scope.scopeType
      && String(grantedScope.scopeId) === String(scope.scopeId)
      && (grantedScope.permissions || []).includes(permission)
    ));
  }

  return {
    authenticate: (req, res, next) => {
      const rawAuth = req.headers['x-auth-context'];
      req.auth = rawAuth ? JSON.parse(rawAuth) : { permissions: [], scopes: [] };
      next();
    },
    authorizePermissions: (...permissions) => (req, res, next) => {
      const hasAll = permissions.every((permission) => (req.auth.permissions || []).includes(permission));

      if (!hasAll) {
        next(new AppErrorMock('Forbidden', httpStatusMock.FORBIDDEN, true, errorCodesMock.AUTHORIZATION_ERROR));
        return;
      }

      next();
    },
    authorizeScopedPermission: (permission, scopeResolver) => (req, res, next) => {
      const scope = scopeResolver(req);

      if (!canAccessScope(req.auth, permission, scope)) {
        next(new AppErrorMock('Forbidden', httpStatusMock.FORBIDDEN, true, errorCodesMock.AUTHORIZATION_ERROR));
        return;
      }

      next();
    },
  };
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use(shopRouter);
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
            resolve({
              statusCode: res.statusCode,
              body: responseBody ? JSON.parse(responseBody) : null,
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

describe('shop routes', () => {
  const shopId = '660000000000000000000001';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /:shopId denies access without scoped permission', async () => {
    const response = await request(createTestServer(), {
      method: 'GET',
      path: `/${shopId}`,
      headers: {
        'X-Auth-Context': JSON.stringify({ permissions: [], scopes: [] }),
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body.error.code).toBe(errorCodes.AUTHORIZATION_ERROR);
    expect(shopService.getShop).not.toHaveBeenCalled();
  });

  test('GET /:shopId allows access with scoped permission', async () => {
    shopService.getShop.mockResolvedValue({
      id: shopId,
      name: 'LNG Amazon US',
      status: 'ACTIVE',
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: `/${shopId}`,
      headers: {
        'X-Auth-Context': JSON.stringify({
          permissions: [],
          scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['SHOPS:READ'] }],
        }),
      },
    });

    expect(response.statusCode).toBe(httpStatus.OK);
    expect(response.body.data).toMatchObject({ id: shopId });
    expect(shopService.getShop).toHaveBeenCalledWith(shopId);
  });

  test('GET /:shopId allows global SHOPS:READ', async () => {
    shopService.getShop.mockResolvedValue({
      id: shopId,
      name: 'LNG Amazon US',
      status: 'ACTIVE',
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: `/${shopId}`,
      headers: {
        'X-Auth-Context': JSON.stringify({ permissions: ['SHOPS:READ'], scopes: [] }),
      },
    });

    expect(response.statusCode).toBe(httpStatus.OK);
    expect(response.body.data).toMatchObject({ id: shopId });
  });

  test('GET /:shopId forwards inactive shop errors from service', async () => {
    shopService.getShop.mockRejectedValue(
      new AppError('Shop is not active', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR),
    );

    const response = await request(createTestServer(), {
      method: 'GET',
      path: `/${shopId}`,
      headers: {
        'X-Auth-Context': JSON.stringify({ permissions: ['SHOPS:READ'], scopes: [] }),
      },
    });

    expect(response.statusCode).toBe(httpStatus.CONFLICT);
    expect(response.body.error.code).toBe(errorCodes.CONFLICT_ERROR);
  });
});
