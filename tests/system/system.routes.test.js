const http = require('http');
const express = require('express');

jest.mock('../../src/modules/system/services/systemHealth.service', () => ({
  getHealth: jest.fn(),
  getLogs: jest.fn(),
}));

jest.mock('../../src/modules/auth/public', () => {
  const AppError = require('../../src/shared/errors/appError');
  const httpStatus = require('../../src/shared/constants/httpStatus');
  const errorCodes = require('../../src/shared/constants/errorCodes');
  return {
    authenticate: (req, res, next) => {
      const context = req.headers['x-auth-context'];
      if (!context) return next(new AppError('Authentication required', 401, true, 'AUTHENTICATION_ERROR'));
      req.auth = JSON.parse(context);
      return next();
    },
    authorizePermissions: (...permissions) => (req, res, next) => {
      const granted = req.auth.permissions || [];
      if (permissions.every((permission) => granted.includes(permission))) return next();
      return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
    },
  };
});

const router = require('../../src/modules/system/routes');
const service = require('../../src/modules/system/services/systemHealth.service');
const errorHandler = require('../../src/middlewares/errorHandler');

function createServer() {
  const app = express();
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, path, authContext) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const req = http.request({
        port: server.address().port,
        path,
        headers: authContext ? { 'X-Auth-Context': JSON.stringify(authContext) } : {},
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => server.close(() => resolve({
          statusCode: res.statusCode,
          body: body ? JSON.parse(body) : null,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      req.end();
    });
  });
}

describe('system routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.getHealth.mockResolvedValue({ status: 'ok' });
    service.getLogs.mockResolvedValue({ process: 'lng-web-be', stream: 'out', content: ['ok'] });
  });

  test('health remains public', async () => {
    const response = await request(createServer(), '/health');

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual({ status: 'ok' });
  });

  test('logs require global AUDIT:READ and forward validated query', async () => {
    const anonymous = await request(createServer(), '/logs?process=lng-web-be');
    const scoped = await request(createServer(), '/logs?process=lng-web-be', {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: 'shop-1', permissions: ['AUDIT:READ'] }],
    });
    const allowed = await request(createServer(), '/logs?process=lng-web-be&stream=error&lines=100', {
      permissions: ['AUDIT:READ'],
    });

    expect(anonymous.statusCode).toBe(401);
    expect(scoped.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(service.getLogs).toHaveBeenCalledWith({
      process: 'lng-web-be',
      stream: 'error',
      lines: '100',
    });
  });
});
