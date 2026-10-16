const http = require('http');
const express = require('express');
const errorHandler = require('../../../src/middlewares/errorHandler');

jest.mock('../../../src/modules/auth/public', () => {
  const AppError = require('../../../src/shared/errors/appError');
  const errorCodes = require('../../../src/shared/constants/errorCodes');
  const httpStatus = require('../../../src/shared/constants/httpStatus');
  const authorize = (...permissions) => (req, _res, next) => (
    permissions.some((permission) => (req.auth.permissions || []).includes(permission))
      ? next()
      : next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR))
  );
  const authorizeAny = (...permissions) => (req, _res, next) => {
    const granted = [
      ...(req.auth.permissions || []),
      ...(req.auth.scopes || []).flatMap((scope) => scope.permissions || []),
    ];
    return permissions.some((permission) => granted.includes(permission))
      ? next()
      : next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
  };
  return {
    authenticate: (req, _res, next) => {
      req.auth = JSON.parse(req.headers['x-auth-context'] || '{"permissions":[]}');
      next();
    },
    authorizeAnyPermission: authorizeAny,
    authorizeAnyGlobalPermission: authorize,
    authorizeScopedPermission: (permission) => authorize(permission),
  };
});

jest.mock('../../../src/modules/hr/services/calendarPolicy.service', () => ({
  bulkImportHolidays: jest.fn().mockResolvedValue({ imported: 2 }),
  checkHoliday: jest.fn().mockResolvedValue({ holiday: null }),
  createRotation: jest.fn().mockResolvedValue({ id: 'r1', source: 'MANUAL' }),
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
  listRotationMatrix: jest.fn().mockResolvedValue({ teams: [] }),
  summarizeHolidays: jest.fn().mockResolvedValue({ year: 2026, paid: 1 }),
  updateHoliday: jest.fn().mockResolvedValue({ id: 'h1', name: 'Updated' }),
  updateRotation: jest.fn().mockResolvedValue({ id: 'r1', isOffDay: false }),
}));

const router = require('../../../src/modules/hr/routes');

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request({ method, path, permission, authContext, body }) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: {
          'X-Auth-Context': JSON.stringify(authContext || { permissions: permission ? [permission] : [] }),
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
    ['GET', '/saturday-rotations/matrix?month=9&year=2026', 200],
  ])('%s %s is available with calendar read', async (method, path, statusCode) => {
    const response = await request({ method, path, permission: 'HR_CALENDAR:READ' });
    expect(response.statusCode).toBe(statusCode);
    expect(response.body).toMatchObject({ success: true, data: expect.anything() });
  });

  test.each([
    ['POST', '/holidays', { dateKey: '2026-09-06', name: 'Holiday' }, 201],
    ['PATCH', '/holidays/507f1f77bcf86cd799439013', { name: 'Updated' }, 200],
    ['DELETE', '/holidays/507f1f77bcf86cd799439013', undefined, 200],
    ['POST', '/holidays/bulk-import', { items: [{ dateKey: '2026-09-06', name: 'Holiday', holidayType: 'PUBLIC_HOLIDAY' }] }, 200],
    ['POST', '/saturday-rotations', { teamId: '507f1f77bcf86cd799439012', dateKey: '2026-09-05', employeeProfileIds: [] }, 201],
    ['POST', '/saturday-rotations/generate', { teamId: '507f1f77bcf86cd799439012', month: 9, year: 2026 }, 200],
    ['PATCH', '/saturday-rotations/507f1f77bcf86cd799439014', { employeeProfileIds: [] }, 200],
    ['DELETE', '/saturday-rotations/507f1f77bcf86cd799439014', undefined, 200],
    ['DELETE', '/saturday-rotations/team/507f1f77bcf86cd799439012?month=9&year=2026', undefined, 200],
  ])('%s %s is available with calendar write', async (method, path, body, statusCode) => {
    const response = await request({ method, path, body, permission: 'HR_CALENDAR:WRITE' });
    expect(response.statusCode).toBe(statusCode);
    expect(response.body).toMatchObject({ success: true, data: expect.anything() });
  });

  test('calendar read cannot mutate resources', async () => {
    const response = await request({
      method: 'POST',
      path: '/holidays',
      permission: 'HR_CALENDAR:READ',
      body: { dateKey: '2026-09-06', name: 'Holiday', holidayType: 'PUBLIC_HOLIDAY' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body.success).toBe(false);
  });

  test.each(['HR_CALENDAR:WRITE', 'HR_SATURDAY_ROTATION:WRITE'])('team-scoped %s can create a rotation for its team', async (permission) => {
    const response = await request({
      method: 'POST',
      path: '/saturday-rotations',
      authContext: {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: '507f1f77bcf86cd799439012',
          permissions: [permission],
        }],
      },
      body: { teamId: '507f1f77bcf86cd799439012', dateKey: '2026-09-05', employeeProfileIds: [] },
    });
    expect(response.statusCode).toBe(201);
  });

  test('schedule permission alone cannot access calendar resources', async () => {
    const response = await request({ method: 'GET', path: '/holidays', permission: 'HR_SCHEDULE:READ' });
    expect(response.statusCode).toBe(403);
  });
});
