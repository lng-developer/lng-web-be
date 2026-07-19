const http = require('http');
const express = require('express');
const errorHandler = require('../../../middlewares/errorHandler');

jest.mock('../../../modules/auth/public', () => {
  const AppError = require('../../../shared/errors/appError');
  const errorCodes = require('../../../shared/constants/errorCodes');
  const httpStatus = require('../../../shared/constants/httpStatus');

  return {
    authenticate: (req, _res, next) => {
      req.auth = JSON.parse(req.headers['x-auth-context'] || '{"permissions":[]}');
      next();
    },
    authorizeAnyPermission: (...permissions) => (req, _res, next) => (
      permissions.some((permission) => (req.auth.permissions || []).includes(permission))
        ? next()
        : next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR))
    ),
    authorizeScopedPermission: (permission, scope) => (req, _res, next) => (
      scope?.scopeType === 'global' && (req.auth.permissions || []).includes(permission)
        ? next()
        : next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR))
    ),
  };
});
jest.mock('../../../modules/hr/services/schedule.service', () => ({
  createShift: jest.fn(),
  listShifts: jest.fn(),
}));

const service = require('../../../modules/hr/services/schedule.service');
const router = require('../../../modules/hr/routes');

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => server.close(() => resolve({
          statusCode: res.statusCode,
          body: responseBody && String(res.headers['content-type'] || '').includes('application/json')
            ? JSON.parse(responseBody)
            : responseBody || null,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('schedule routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /shifts permits schedule read and POST /shifts requires schedule write', async () => {
    service.listShifts.mockResolvedValue({ items: [] });

    const readable = await request(createServer(), {
      method: 'GET',
      path: '/shifts',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['HR_SCHEDULE:READ'] }) },
    });
    expect(readable.statusCode).toBe(200);
    expect(service.listShifts).toHaveBeenCalledWith({}, { permissions: ['HR_SCHEDULE:READ'] });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: '/shifts',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['HR_SCHEDULE:READ'] }) },
      body: { code: 'DAY', name: 'Day', startTime: '08:00', endTime: '17:00' },
    });
    expect(forbidden.statusCode).toBe(403);

    const writable = await request(createServer(), {
      method: 'POST',
      path: '/shifts',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['HR_SCHEDULE:WRITE'] }) },
      body: { code: 'DAY', name: 'Day', startTime: '08:00', endTime: '17:00' },
    });
    expect(writable.statusCode).toBe(201);
    expect(service.createShift).toHaveBeenCalledWith(expect.objectContaining({ code: 'DAY' }), {
      permissions: ['HR_SCHEDULE:WRITE'],
    });
  });
});
