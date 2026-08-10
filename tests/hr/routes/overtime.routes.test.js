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
jest.mock('../../../src/modules/hr/services/overtime.service', () => ({
  approveRequest: jest.fn(),
  cancelRequest: jest.fn(),
  createRequest: jest.fn(),
  listRequests: jest.fn(),
  rejectRequest: jest.fn(),
  updateRequest: jest.fn(),
}));

const OvertimeRequest = require('../../../src/modules/hr/models/overtimeRequest.model');
const router = require('../../../src/modules/hr/routes');
const service = require('../../../src/modules/hr/services/overtime.service');

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

describe('overtime routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('stores overtime durations as integer minutes and protects active minute conflicts', async () => {
    const requestModel = new OvertimeRequest({
      profileId: '660000000000000000000001',
      accountId: '660000000000000000000002',
      workDateKey: '2026-07-20',
      plannedStartTime: '18:00',
      plannedEndTime: '20:00',
      plannedStartAt: new Date('2026-07-20T11:00:00.000Z'),
      plannedEndAt: new Date('2026-07-20T13:00:00.000Z'),
      startMinute: 1080,
      endMinute: 1200,
      requestedMinutes: 1.5,
      calendarClass: 'WORKDAY',
      conflictMinuteKeys: [1080],
      requesterSnapshot: {
        accountId: '660000000000000000000002',
        profileId: '660000000000000000000001',
        fullName: 'Test Employee',
      },
      scheduleSnapshot: {
        timezone: 'Asia/Ho_Chi_Minh',
        calendarStatus: 'WORKING_DAY',
        workLocation: { id: '660000000000000000000003' },
        shift: {
          id: '660000000000000000000004', startTime: '08:00', endTime: '17:00', durationMinutes: 540,
        },
      },
      reason: 'Invalid minutes',
    });
    await expect(requestModel.validate()).rejects.toMatchObject({
      errors: { requestedMinutes: expect.any(Object) },
    });

    const conflictIndex = OvertimeRequest.schema.indexes().find(([keys]) => (
      keys.profileId === 1 && keys.conflictMinuteKeys === 1
    ));
    expect(conflictIndex).toEqual([
      { profileId: 1, conflictMinuteKeys: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] } },
      }),
    ]);
  });

  test('creates and lists own overtime requests with write permission', async () => {
    service.createRequest.mockResolvedValue({ id: 'ot-1', status: 'PENDING' });
    service.listRequests.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0 } });

    const created = await request(createServer(), {
      method: 'POST',
      path: '/overtime-requests',
      permissions: ['HR_OVERTIME:WRITE'],
      body: {
        workDateKey: '2026-07-20',
        plannedStartTime: '18:00',
        plannedEndTime: '20:00',
        reason: 'Month-end support',
      },
    });
    const listed = await request(createServer(), {
      method: 'GET',
      path: '/overtime-requests/me?page=1&limit=20',
      permissions: ['HR_OVERTIME:WRITE'],
    });

    expect(created.statusCode).toBe(201);
    expect(service.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      workDateKey: '2026-07-20', plannedStartTime: '18:00', plannedEndTime: '20:00',
    }), expect.objectContaining({ accountId: '660000000000000000000002' }));
    expect(listed.statusCode).toBe(200);
    expect(service.listRequests).toHaveBeenCalledWith(
      { page: 1, limit: 20, own: true },
      expect.objectContaining({ accountId: '660000000000000000000002' }),
    );
  });

  test('updates an overtime request through the write contract', async () => {
    service.updateRequest.mockResolvedValue({ id: 'ot-1', status: 'PENDING' });
    const response = await request(createServer(), {
      method: 'PATCH', path: '/overtime-requests/660000000000000000000010', permissions: ['HR_OVERTIME:WRITE'],
      body: { workDateKey: '2026-07-20', plannedStartTime: '18:30', plannedEndTime: '20:30', reason: 'Revised support window' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.updateRequest).toHaveBeenCalledWith('660000000000000000000010', expect.objectContaining({ plannedStartTime: '18:30' }), expect.objectContaining({ accountId: '660000000000000000000002' }));
  });

  test('rejects invalid duration and approval payloads at the HTTP boundary', async () => {
    const invalidRequest = await request(createServer(), {
      method: 'POST',
      path: '/overtime-requests',
      permissions: ['HR_OVERTIME:WRITE'],
      body: {
        workDateKey: '2026-07-20',
        plannedStartTime: '18:00',
        plannedEndTime: '18:29',
        reason: 'Too short',
      },
    });
    const invalidApproval = await request(createServer(), {
      method: 'POST',
      path: '/overtime-requests/660000000000000000000010/approve',
      permissions: ['HR_OVERTIME:APPROVE'],
      body: { approvedMinutes: 0 },
    });

    expect(invalidRequest.statusCode).toBe(400);
    expect(invalidApproval.statusCode).toBe(400);
    expect(service.createRequest).not.toHaveBeenCalled();
    expect(service.approveRequest).not.toHaveBeenCalled();
  });

  test('requires approve permission for decisions and forwards partial approval', async () => {
    service.approveRequest.mockResolvedValue({ id: 'ot-1', status: 'APPROVED', approvedMinutes: 90 });
    const denied = await request(createServer(), {
      method: 'POST',
      path: '/overtime-requests/660000000000000000000010/approve',
      permissions: ['HR_OVERTIME:WRITE'],
      body: { approvedMinutes: 90 },
    });
    const approved = await request(createServer(), {
      method: 'POST',
      path: '/overtime-requests/660000000000000000000010/approve',
      permissions: ['HR_OVERTIME:APPROVE'],
      body: { approvedMinutes: 90 },
    });

    expect(denied.statusCode).toBe(403);
    expect(approved.statusCode).toBe(200);
    expect(service.approveRequest).toHaveBeenCalledWith(
      '660000000000000000000010',
      { approvedMinutes: 90 },
      expect.objectContaining({ accountId: '660000000000000000000002' }),
    );
  });

  test('forwards reject and cancel lifecycle decisions', async () => {
    service.rejectRequest.mockResolvedValue({ id: 'ot-1', status: 'REJECTED' });
    service.cancelRequest.mockResolvedValue({ id: 'ot-2', status: 'CANCELLED' });

    const rejected = await request(createServer(), {
      method: 'POST',
      path: '/overtime-requests/660000000000000000000010/reject',
      permissions: ['HR_OVERTIME:APPROVE'],
      body: { reason: 'No coverage' },
    });
    const cancelled = await request(createServer(), {
      method: 'POST',
      path: '/overtime-requests/660000000000000000000011/cancel',
      permissions: ['HR_OVERTIME:WRITE'],
      body: {},
    });

    expect(rejected.statusCode).toBe(200);
    expect(cancelled.statusCode).toBe(200);
    expect(service.cancelRequest).toHaveBeenCalledWith('660000000000000000000011', {}, expect.objectContaining({ accountId: '660000000000000000000002' }));
  });
});
