const http = require('http');
const express = require('express');
const errorHandler = require('../../../middlewares/errorHandler');

jest.mock('../../../modules/auth/public', () => {
  const AppError = require('../../../shared/errors/appError');
  const errorCodes = require('../../../shared/constants/errorCodes');
  const httpStatus = require('../../../shared/constants/httpStatus');
  const authorize = (...permissions) => (req, _res, next) => (
    permissions.some((permission) => (req.auth.permissions || []).includes(permission))
      ? next()
      : next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR))
  );
  return {
    authenticate: (req, _res, next) => {
      req.auth = JSON.parse(req.headers['x-auth-context'] || '{"permissions":[]}');
      next();
    },
    authorizeAnyPermission: authorize,
    authorizeScopedPermission: (permission) => authorize(permission),
  };
});

jest.mock('../../../modules/hr/services/calendarPolicy.service', () => ({
  bulkImportHolidays: jest.fn().mockResolvedValue({ imported: 2 }),
  checkHoliday: jest.fn().mockResolvedValue({ holiday: null }),
  createHoliday: jest.fn().mockResolvedValue({ id: 'h1', name: 'Holiday' }),
  deleteHoliday: jest.fn().mockResolvedValue({ id: 'h1', isActive: false }),
  deleteRotation: jest.fn().mockResolvedValue({ id: 'r1', isActive: false }),
  deleteTeamRotations: jest.fn().mockResolvedValue({ deleted: 2 }),
  generateRotations: jest.fn().mockResolvedValue({ generated: 2 }),
  getHoliday: jest.fn().mockResolvedValue({ id: 'h1', name: 'Holiday' }),
  listHolidayRange: jest.fn().mockResolvedValue({ items: [{ id: 'h1' }] }),
  listHolidayTemplates: jest.fn().mockResolvedValue({ items: [{ holidayType: 'PUBLIC_HOLIDAY' }] }),
  listHolidays: jest.fn().mockResolvedValue({ items: [{ id: 'h1' }] }),
  listRotations: jest.fn().mockResolvedValue({ items: [{ id: 'r1' }] }),
  summarizeHolidays: jest.fn().mockResolvedValue({ year: 2026, paid: 1 }),
  updateHoliday: jest.fn().mockResolvedValue({ id: 'h1', name: 'Updated' }),
  updateRotation: jest.fn().mockResolvedValue({ id: 'r1', isOffDay: false }),
}));

const router = require('../../../modules/hr/routes');

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request({ method, path, permission, body }) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: {
          'X-Auth-Context': JSON.stringify({ permissions: permission ? [permission] : [] }),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => server.close(() => resolve({
          statusCode: res.statusCode,
          body: responseBody ? JSON.parse(responseBody) : null,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('calendar policy routes', () => {
  test.each([
    ['GET', '/holidays', 200],
    ['GET', '/holidays/507f1f77bcf86cd799439013', 200],
    ['GET', '/holidays/range?dateFrom=2026-01-01&dateTo=2026-12-31', 200],
    ['GET', '/holidays/check?dateKey=2026-09-06&teamId=507f1f77bcf86cd799439012', 200],
    ['GET', '/holidays/summary/2026', 200],
    ['GET', '/holidays/templates', 200],
    ['GET', '/saturday-rotations?teamId=507f1f77bcf86cd799439012', 200],
  ])('%s %s is available with calendar read', async (method, path, statusCode) => {
    const response = await request({ method, path, permission: 'HR_SCHEDULE:READ' });
    expect(response.statusCode).toBe(statusCode);
    expect(response.body).toMatchObject({ success: true, data: expect.anything() });
  });

  test.each([
    ['POST', '/holidays', { dateKey: '2026-09-06', name: 'Holiday', holidayType: 'PUBLIC_HOLIDAY' }, 201],
    ['PATCH', '/holidays/507f1f77bcf86cd799439013', { name: 'Updated' }, 200],
    ['DELETE', '/holidays/507f1f77bcf86cd799439013', undefined, 200],
    ['POST', '/holidays/bulk-import', { items: [{ dateKey: '2026-09-06', name: 'Holiday', holidayType: 'PUBLIC_HOLIDAY' }] }, 200],
    ['POST', '/saturday-rotations/generate', { teamId: '507f1f77bcf86cd799439012', month: 9, year: 2026 }, 200],
    ['PATCH', '/saturday-rotations/507f1f77bcf86cd799439014', { employeeProfileIds: [] }, 200],
    ['DELETE', '/saturday-rotations/507f1f77bcf86cd799439014', undefined, 200],
    ['DELETE', '/saturday-rotations/team/507f1f77bcf86cd799439012?month=9&year=2026', undefined, 200],
  ])('%s %s is available with calendar write', async (method, path, body, statusCode) => {
    const response = await request({ method, path, body, permission: 'HR_SCHEDULE:WRITE' });
    expect(response.statusCode).toBe(statusCode);
    expect(response.body).toMatchObject({ success: true, data: expect.anything() });
  });

  test('calendar read cannot mutate resources', async () => {
    const response = await request({
      method: 'POST',
      path: '/holidays',
      permission: 'HR_SCHEDULE:READ',
      body: { dateKey: '2026-09-06', name: 'Holiday', holidayType: 'PUBLIC_HOLIDAY' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body.success).toBe(false);
  });
});
