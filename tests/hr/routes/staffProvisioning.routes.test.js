const http = require('http');
const express = require('express');
const errorHandler = require('../../../src/middlewares/errorHandler');

jest.mock('../../../src/modules/auth/public', () => {
  const AppError = require('../../../src/shared/errors/appError');
  const errorCodes = require('../../../src/shared/constants/errorCodes');
  const httpStatus = require('../../../src/shared/constants/httpStatus');
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
    authorizeAnyGlobalPermission: (...permissions) => (req, _res, next) => (
      permissions.some((permission) => (req.auth.permissions || []).includes(permission))
        ? next()
        : next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR))
    ),
    authorizeScopedPermission: () => (_req, _res, next) => next(),
  };
});
jest.mock('../../../src/modules/hr/services/staffProvisioning.service', () => ({
  provisionStaff: jest.fn(),
  listAssignableRoles: jest.fn(),
}));

const service = require('../../../src/modules/hr/services/staffProvisioning.service');
const router = require('../../../src/modules/hr/routes');

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method = 'POST', path = '/staff-provisioning', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request({
        method, port: server.address().port, path,
        headers: payload === null ? headers : {
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers,
        },
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => server.close(() => resolve({
          statusCode: res.statusCode,
          body: res.headers['content-type']?.includes('application/json')
            ? JSON.parse(responseBody)
            : responseBody,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (payload !== null) req.write(payload);
      req.end();
    });
  });
}

const payload = {
  employeeCode: 'J2501', workEmail: 'jane@example.com', fullName: 'Jane Nguyen',
  departmentId: '660000000000000000000002', teamId: '660000000000000000000003',
  employmentType: 'FULL_TIME', workMode: 'ONSITE', startDate: '2026-07-29',
  baseSalary: 15000000,
  assignments: [{ roleId: '660000000000000000000005', scopeType: 'department', scopeId: '660000000000000000000002' }],
};

describe('staff provisioning routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('POST /staff-provisioning requires HR employee write and returns a safe result', async () => {
    service.provisionStaff.mockResolvedValue({
      accountId: '660000000000000000000001', mustChangePassword: true, isProfileUpdated: false,
      leaveBalance: { year: 2026, leaveType: 'ANNUAL' },
    });
    const forbidden = await request(createServer(), { body: payload });
    expect(forbidden.statusCode).toBe(403);

    const auth = { permissions: ['HR_EMPLOYEES:WRITE'] };
    const allowed = await request(createServer(), {
      headers: { 'X-Auth-Context': JSON.stringify(auth) }, body: payload,
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.body.data).not.toHaveProperty('password');
    expect(service.provisionStaff).toHaveBeenCalledWith(expect.objectContaining({
      employeeCode: 'J2501', workEmail: 'jane@example.com',
    }), auth, expect.objectContaining({ requestId: undefined }));
  });

  test('GET /staff-provisioning/roles lets an HR writer read only the assignable role catalog', async () => {
    service.listAssignableRoles.mockResolvedValue([{
      id: '660000000000000000000005', name: 'Operator', description: 'Handles daily operations',
    }]);

    const forbidden = await request(createServer(), {
      method: 'GET', path: '/staff-provisioning/roles',
    });
    expect(forbidden.statusCode).toBe(403);

    const auth = { permissions: ['HR_EMPLOYEES:WRITE'] };
    const allowed = await request(createServer(), {
      method: 'GET', path: '/staff-provisioning/roles',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toEqual({
      success: true,
      data: [{
        id: '660000000000000000000005', name: 'Operator', description: 'Handles daily operations',
      }],
    });
    expect(allowed.body.data[0]).not.toHaveProperty('code');
    expect(allowed.body.data[0]).not.toHaveProperty('permissions');
    expect(service.listAssignableRoles).toHaveBeenCalledWith(auth);
  });
});
