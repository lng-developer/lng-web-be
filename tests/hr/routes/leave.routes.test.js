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
jest.mock('../../../src/modules/hr/services/leave.service', () => ({
  accrueBalances: jest.fn(),
  adjustBalance: jest.fn(),
  approveRequest: jest.fn(),
  attachReferences: jest.fn(),
  cancelRequest: jest.fn(),
  carryOverBalances: jest.fn(),
  createRequest: jest.fn(),
  getBalance: jest.fn(),
  getMyBalances: jest.fn(),
  listRequests: jest.fn(),
  previewRequest: jest.fn(),
  rejectRequest: jest.fn(),
  refundRequest: jest.fn(),
  resetBalances: jest.fn(),
  upsertBalance: jest.fn(),
  updateRequest: jest.fn(),
}));

const service = require('../../../src/modules/hr/services/leave.service');
const LeaveBalance = require('../../../src/modules/hr/models/leaveBalance.model');
const LeaveRequest = require('../../../src/modules/hr/models/leaveRequest.model');
const router = require('../../../src/modules/hr/routes');

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

  test('updates a leave request through the write contract', async () => {
    service.updateRequest.mockResolvedValue({ id: 'leave-1', status: 'PENDING' });
    const response = await request(createServer(), {
      method: 'PATCH', path: '/leave-requests/660000000000000000000010', permissions: ['HR_LEAVE:WRITE'],
      body: { leaveType: 'SICK', portion: 'FULL_DAY', startDateKey: '2026-07-20', endDateKey: '2026-07-20', reason: 'Medical appointment' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.updateRequest).toHaveBeenCalledWith('660000000000000000000010', expect.objectContaining({ leaveType: 'SICK' }), expect.objectContaining({ accountId: '660000000000000000000002' }));
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

  test('allows the requester to cancel a pending leave request without a reason', async () => {
    service.cancelRequest.mockResolvedValue({ id: 'leave-1', status: 'CANCELLED' });
    const response = await request(createServer(), {
      method: 'POST', path: '/leave-requests/660000000000000000000010/cancel', permissions: ['HR_LEAVE:WRITE'], body: {},
    });

    expect(response.statusCode).toBe(200);
    expect(service.cancelRequest).toHaveBeenCalledWith('660000000000000000000010', {}, expect.objectContaining({ accountId: '660000000000000000000002' }));
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

  test('exposes preview and media-reference attachment contracts', async () => {
    service.previewRequest.mockResolvedValue({ isPossible: true, requestedUnits: 2 });
    service.attachReferences.mockResolvedValue({ id: 'leave-1', attachments: [{ mediaId: 'media-1' }] });

    const preview = await request(createServer(), {
      method: 'POST',
      path: '/leave-requests/preview',
      permissions: ['HR_LEAVE:WRITE'],
      body: {
        leaveType: 'ANNUAL', portion: 'FULL_DAY', startDateKey: '2026-12-15', endDateKey: '2026-12-15', reason: 'Trip',
      },
    });
    const attached = await request(createServer(), {
      method: 'POST',
      path: '/leave-requests/660000000000000000000010/attachments',
      permissions: ['HR_LEAVE:WRITE'],
      body: { attachments: [{ mediaId: 'media-1', filename: 'note.pdf', mimeType: 'application/pdf' }] },
    });

    expect(preview.statusCode).toBe(200);
    expect(attached.statusCode).toBe(200);
    expect(service.attachReferences).toHaveBeenCalledWith(
      '660000000000000000000010',
      { attachments: [{ mediaId: 'media-1', filename: 'note.pdf', mimeType: 'application/pdf' }] },
      expect.objectContaining({ accountId: '660000000000000000000002' }),
    );
  });

  test('exposes date-specific approved leave refund', async () => {
    service.refundRequest.mockResolvedValue({ id: 'leave-1', status: 'APPROVED', refundedDateKeys: ['2026-12-16'] });

    const response = await request(createServer(), {
      method: 'POST',
      path: '/leave-requests/660000000000000000000010/refund',
      permissions: ['HR_LEAVE:APPROVE'],
      body: { dateKeys: ['2026-12-16'], reason: 'Employee worked this day' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.refundRequest).toHaveBeenCalledWith(
      '660000000000000000000010',
      { dateKeys: ['2026-12-16'], reason: 'Employee worked this day' },
      expect.objectContaining({ accountId: '660000000000000000000002' }),
    );
  });

  test('rejects filesystem paths as attachment media references', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/leave-requests/660000000000000000000010/attachments',
      permissions: ['HR_LEAVE:WRITE'],
      body: { attachments: [{ mediaId: 'C:\\uploads\\leave-note.pdf' }] },
    });

    expect(response.statusCode).toBe(400);
    expect(service.attachReferences).not.toHaveBeenCalled();
  });

  test('guards balance adjust, accrue, reset and carry-over with approve permission', async () => {
    service.adjustBalance.mockResolvedValue({ availableUnits: 26 });
    service.accrueBalances.mockResolvedValue({ processed: 1, changed: 1, items: [] });
    service.resetBalances.mockResolvedValue({ processed: 1, items: [] });
    service.carryOverBalances.mockResolvedValue({ processed: 1, items: [] });
    const permissions = ['HR_LEAVE:APPROVE'];
    const profileId = '660000000000000000000001';

    const responses = await Promise.all([
      request(createServer(), {
        method: 'PATCH', path: `/leave-balances/${profileId}/2026/ANNUAL/adjust`, permissions,
        body: { units: 2, reason: 'Correction' },
      }),
      request(createServer(), {
        method: 'POST', path: '/leave-balances/accrue', permissions,
        body: { profileIds: [profileId], year: 2026, month: 7, units: 2, reason: 'July' },
      }),
      request(createServer(), {
        method: 'POST', path: '/leave-balances/reset', permissions,
        body: { profileIds: [profileId], year: 2026, leaveType: 'ANNUAL', entitledUnits: 24, reason: 'Reset' },
      }),
      request(createServer(), {
        method: 'POST', path: '/leave-balances/carry-over', permissions,
        body: { profileIds: [profileId], fromYear: 2025, toYear: 2026, leaveType: 'ANNUAL', maxUnits: 10, reason: 'Carry' },
      }),
    ]);

    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200, 200, 200]);
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
