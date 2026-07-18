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
  };
});
jest.mock('../../../modules/hr/services/attendance.service', () => ({
  adjustAttendance: jest.fn(),
  checkIn: jest.fn(),
  checkOut: jest.fn(),
  listAttendance: jest.fn(),
}));

const service = require('../../../modules/hr/services/attendance.service');
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

describe('attendance routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('self check-in never accepts a target profile id', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/attendance/check-in',
      headers: { 'X-Auth-Context': JSON.stringify({ accountId: 'a1', permissions: ['HR_ATTENDANCE:WRITE'] }) },
      body: { occurredAt: '2026-07-18T01:00:00.000Z', profileId: '660000000000000000000001' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.checkIn).not.toHaveBeenCalled();
  });

  test('write permission allows self attendance but not managed adjustment', async () => {
    service.checkIn.mockResolvedValue({ id: 'attendance-1' });
    const headers = { 'X-Auth-Context': JSON.stringify({ accountId: 'a1', permissions: ['HR_ATTENDANCE:WRITE'] }) };

    const checkedIn = await request(createServer(), {
      method: 'POST',
      path: '/attendance/check-in',
      headers,
      body: { occurredAt: '2026-07-18T01:00:00.000Z' },
    });
    expect(checkedIn.statusCode).toBe(201);
    expect(service.checkIn).toHaveBeenCalledWith(
      { accountId: 'a1', permissions: ['HR_ATTENDANCE:WRITE'] },
      { occurredAt: '2026-07-18T01:00:00.000Z' },
    );

    const adjusted = await request(createServer(), {
      method: 'PATCH',
      path: '/attendance/660000000000000000000010',
      headers,
      body: { reason: 'Correction', checkOutAt: '2026-07-18T10:00:00.000Z' },
    });
    expect(adjusted.statusCode).toBe(403);
    expect(service.adjustAttendance).not.toHaveBeenCalled();
  });

  test('self list is forced to the authenticated profile while management list is scoped', async () => {
    service.listAttendance.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0 } });

    const self = await request(createServer(), {
      method: 'GET',
      path: '/attendance/me?page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify({ accountId: 'a1', permissions: ['HR_ATTENDANCE:WRITE'] }) },
    });
    expect(self.statusCode).toBe(200);
    expect(service.listAttendance).toHaveBeenCalledWith(
      { page: 1, limit: 20, own: true },
      { accountId: 'a1', permissions: ['HR_ATTENDANCE:WRITE'] },
    );

    const management = await request(createServer(), {
      method: 'GET',
      path: '/attendance?status=PRESENT',
      headers: { 'X-Auth-Context': JSON.stringify({ accountId: 'm1', permissions: ['HR_ATTENDANCE:READ'] }) },
    });
    expect(management.statusCode).toBe(200);
    expect(service.listAttendance).toHaveBeenCalledWith(
      { status: 'PRESENT' },
      { accountId: 'm1', permissions: ['HR_ATTENDANCE:READ'] },
    );
  });

  test('self list rejects a target profile query', async () => {
    const response = await request(createServer(), {
      method: 'GET',
      path: '/attendance/me?profileId=660000000000000000000001',
      headers: { 'X-Auth-Context': JSON.stringify({ accountId: 'a1', permissions: ['HR_ATTENDANCE:WRITE'] }) },
    });

    expect(response.statusCode).toBe(400);
    expect(service.listAttendance).not.toHaveBeenCalled();
  });
});
