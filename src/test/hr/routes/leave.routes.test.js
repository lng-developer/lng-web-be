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
jest.mock('../../../modules/hr/services/leave.service', () => ({
  approveRequest: jest.fn(),
  cancelRequest: jest.fn(),
  createRequest: jest.fn(),
  getBalance: jest.fn(),
  getMyBalances: jest.fn(),
  listRequests: jest.fn(),
  rejectRequest: jest.fn(),
  upsertBalance: jest.fn(),
}));

const service = require('../../../modules/hr/services/leave.service');
const LeaveBalance = require('../../../modules/hr/models/leaveBalance.model');
const LeaveRequest = require('../../../modules/hr/models/leaveRequest.model');
const router = require('../../../modules/hr/routes');

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, permissions = [], body }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: {
          'X-Auth-Context': JSON.stringify({ accountId: '660000000000000000000002', permissions }),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
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

describe('leave routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('persists leave quantities only as integer half-day units', async () => {
    const balance = new LeaveBalance({
      profileId: '660000000000000000000001',
      year: 2026,
      leaveType: 'ANNUAL',
      entitledUnits: 1.5,
    });
    const request = new LeaveRequest({
      profileId: '660000000000000000000001',
      accountId: '660000000000000000000002',
      year: 2026,
      leaveType: 'ANNUAL',
      attendanceStatus: 'PAID_LEAVE',
      portion: 'FULL_DAY',
      startDateKey: '2026-07-20',
      endDateKey: '2026-07-20',
      workingDateKeys: ['2026-07-20'],
      workingDateSnapshots: [],
      requestedUnits: 1.5,
      requesterSnapshot: {
        accountId: '660000000000000000000002',
        profileId: '660000000000000000000001',
        fullName: 'Test Employee',
      },
      reason: 'Invalid units',
    });

    await expect(balance.validate()).rejects.toMatchObject({
      errors: { entitledUnits: expect.any(Object) },
    });
    await expect(request.validate()).rejects.toMatchObject({
      errors: { requestedUnits: expect.any(Object) },
    });
  });

  test('uses one active unique conflict index per employee and leave portion', () => {
    const conflictIndex = LeaveRequest.schema.indexes().find(([keys]) => (
      keys.profileId === 1 && keys.conflictKeys === 1
    ));

    expect(conflictIndex).toEqual([
      { profileId: 1, conflictKeys: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: {
          status: { $in: ['PENDING', 'APPROVED'] },
        },
      }),
    ]);
  });

  test('creates a self leave request and lists only own requests with write permission', async () => {
    service.createRequest.mockResolvedValue({ id: 'leave-1', status: 'PENDING' });
    service.listRequests.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0 } });

    const created = await request(createServer(), {
      method: 'POST',
      path: '/leave-requests',
      permissions: ['HR_LEAVE:WRITE'],
      body: {
        leaveType: 'ANNUAL',
        portion: 'FULL_DAY',
        startDateKey: '2026-07-20',
        endDateKey: '2026-07-20',
        reason: 'Family trip',
      },
    });
    const listed = await request(createServer(), {
      method: 'GET',
      path: '/leave-requests/me?page=1&limit=20',
      permissions: ['HR_LEAVE:WRITE'],
    });

    expect(created.statusCode).toBe(201);
    expect(service.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      leaveType: 'ANNUAL',
      startDateKey: '2026-07-20',
    }), expect.objectContaining({ accountId: '660000000000000000000002' }));
    expect(listed.statusCode).toBe(200);
    expect(service.listRequests).toHaveBeenCalledWith(
      { page: 1, limit: 20, own: true },
      expect.objectContaining({ accountId: '660000000000000000000002' }),
    );
  });

  test('rejects an invalid spanning half-day request at the HTTP boundary', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/leave-requests',
      permissions: ['HR_LEAVE:WRITE'],
      body: {
        leaveType: 'ANNUAL',
        portion: 'MORNING',
        startDateKey: '2026-07-20',
        endDateKey: '2026-07-21',
        reason: 'Appointment',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(service.createRequest).not.toHaveBeenCalled();
  });

  test('requires approve permission for decisions and balance management', async () => {
    service.approveRequest.mockResolvedValue({ id: 'leave-1', status: 'APPROVED' });
    service.upsertBalance.mockResolvedValue({ profileId: '660000000000000000000001', year: 2026 });

    const denied = await request(createServer(), {
      method: 'POST',
      path: '/leave-requests/660000000000000000000010/approve',
      permissions: ['HR_LEAVE:WRITE'],
    });
    const approved = await request(createServer(), {
      method: 'POST',
      path: '/leave-requests/660000000000000000000010/approve',
      permissions: ['HR_LEAVE:APPROVE'],
    });
    const balance = await request(createServer(), {
      method: 'PUT',
      path: '/leave-balances/660000000000000000000001/2026/ANNUAL',
      permissions: ['HR_LEAVE:APPROVE'],
      body: { entitledUnits: 24, adjustmentUnits: 0, reason: 'Annual allocation' },
    });

    expect(denied.statusCode).toBe(403);
    expect(approved.statusCode).toBe(200);
    expect(balance.statusCode).toBe(200);
  });

  test('preserves the existing attendance route while adding leave routes', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/attendance/check-in',
      permissions: ['HR_ATTENDANCE:WRITE'],
      body: { occurredAt: 'invalid' },
    });

    expect(response.statusCode).toBe(400);
  });
});
