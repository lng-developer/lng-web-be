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
      permissions.some((permission) => [
        ...(req.auth.permissions || []),
        ...(req.auth.scopes || []).flatMap((scope) => scope.permissions || []),
      ].includes(permission))
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
jest.mock('../../../modules/hr/services/employeeProfile.service', () => ({
  createProfile: jest.fn(),
  deleteProfile: jest.fn(),
  getProfile: jest.fn(),
  listProfiles: jest.fn(),
  restoreProfile: jest.fn(),
  updateProfile: jest.fn(),
}));

const service = require('../../../modules/hr/services/employeeProfile.service');
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

describe('employee profile routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /employee-profiles requires HR employee read permission', async () => {
    service.listProfiles.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0 } });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/employee-profiles',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/employee-profiles?page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['HR_EMPLOYEES:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.listProfiles).toHaveBeenCalledWith(
      { page: 1, limit: 20 },
      { permissions: ['HR_EMPLOYEES:READ'] },
    );
  });

  test('GET /employee-profiles permits schedule-only selector access', async () => {
    service.listProfiles.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0 } });

    const response = await request(createServer(), {
      method: 'GET',
      path: '/employee-profiles?page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['HR_SCHEDULE:READ'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(service.listProfiles).toHaveBeenCalledWith(
      { page: 1, limit: 20 },
      { permissions: ['HR_SCHEDULE:READ'] },
    );
  });

  test('POST /employee-profiles validates required identity fields', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/employee-profiles',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['HR_EMPLOYEES:WRITE'] }) },
      body: { employeeCode: 'j2501' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.createProfile).not.toHaveBeenCalled();
  });

  test('attendance operators can list the directory but cannot open profile detail', async () => {
    service.listProfiles.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0 } });
    const headers = {
      'X-Auth-Context': JSON.stringify({
        scopes: [{
          scopeType: 'department',
          scopeId: '660000000000000000000002',
          permissions: ['HR_ATTENDANCE:READ'],
        }],
      }),
    };

    const directory = await request(createServer(), {
      method: 'GET',
      path: '/employee-profiles?page=1&limit=20',
      headers,
    });
    const detail = await request(createServer(), {
      method: 'GET',
      path: '/employee-profiles/660000000000000000000004',
      headers,
    });

    expect(directory.statusCode).toBe(200);
    expect(detail.statusCode).toBe(403);
    expect(service.getProfile).not.toHaveBeenCalled();
  });

  test('all profile mutations require HR_EMPLOYEES:WRITE', async () => {
    const headers = {
      'X-Auth-Context': JSON.stringify({ permissions: ['HR_EMPLOYEES:READ'] }),
    };
    const profileId = '660000000000000000000004';
    const requests = [
      { method: 'POST', path: '/employee-profiles', body: { accountId: '660000000000000000000001', employeeCode: 'J2501', fullName: 'Jane Nguyen' } },
      { method: 'PATCH', path: `/employee-profiles/${profileId}`, body: { jobTitle: 'Lead' } },
      { method: 'DELETE', path: `/employee-profiles/${profileId}` },
      { method: 'PATCH', path: `/employee-profiles/${profileId}/restore` },
    ];

    for (const requestOptions of requests) {
      const response = await request(createServer(), { ...requestOptions, headers });
      expect(response.statusCode).toBe(403);
    }

    expect(service.createProfile).not.toHaveBeenCalled();
    expect(service.updateProfile).not.toHaveBeenCalled();
    expect(service.deleteProfile).not.toHaveBeenCalled();
    expect(service.restoreProfile).not.toHaveBeenCalled();
  });

  test('a scoped employee writer reaches service-level target authorization', async () => {
    service.updateProfile.mockResolvedValue({ id: '660000000000000000000004' });
    const auth = {
      scopes: [{
        scopeType: 'department',
        scopeId: '660000000000000000000002',
        permissions: ['HR_EMPLOYEES:WRITE'],
      }],
    };

    const response = await request(createServer(), {
      method: 'PATCH',
      path: '/employee-profiles/660000000000000000000004',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
      body: { jobTitle: 'Lead' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.updateProfile).toHaveBeenCalledWith(
      '660000000000000000000004',
      { jobTitle: 'Lead' },
      auth,
    );
  });
});
