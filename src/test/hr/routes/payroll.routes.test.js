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
    authorizeScopedPermission: () => (_req, _res, next) => next(),
  };
});
jest.mock('../../../modules/hr/services/payroll.service', () => ({
  calculatePayroll: jest.fn(), finalizePayroll: jest.fn(), getPayrollRun: jest.fn(),
  getPayrollResult: jest.fn(), listMyPayrollResults: jest.fn(), listPayrollResults: jest.fn(), listPayrollRuns: jest.fn(), markPayrollPaid: jest.fn(),
}));
jest.mock('../../../modules/hr/services/payrollAdjustment.service', () => ({
  cancelAdjustment: jest.fn(), createAdjustment: jest.fn(), listAdjustments: jest.fn(), updateAdjustment: jest.fn(),
}));

const router = require('../../../modules/hr/routes');
const payrollService = require('../../../modules/hr/services/payroll.service');

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
        method, port: server.address().port, path,
        headers: {
          'X-Auth-Context': JSON.stringify({ accountId: '682000000000000000000001', permissions }),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => server.close(() => resolve({
          statusCode: res.statusCode,
          body: responseBody && String(res.headers['content-type'] || '').includes('application/json')
            ? JSON.parse(responseBody) : responseBody || null,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('payroll routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses exact HR payroll permissions for list, run, finalize, and mark-paid', async () => {
    payrollService.listPayrollRuns.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0 } });
    payrollService.calculatePayroll.mockResolvedValue({ id: 'run-1' });
    payrollService.finalizePayroll.mockResolvedValue({ id: 'run-1', status: 'FINALIZED' });
    payrollService.markPayrollPaid.mockResolvedValue({ results: [] });

    const listed = await request(createServer(), { method: 'GET', path: '/payrolls', permissions: ['HR_PAYROLL:READ'] });
    const run = await request(createServer(), {
      method: 'POST', path: '/payrolls/run', permissions: ['HR_PAYROLL:WRITE'], body: { month: 7, year: 2026, shadow: true },
    });
    const finalized = await request(createServer(), {
      method: 'POST', path: '/payrolls/682000000000000000000010/finalize', permissions: ['HR_PAYROLL:FINALIZE'], body: { expectedVersion: 0 },
    });
    const paid = await request(createServer(), {
      method: 'POST', path: '/payrolls/682000000000000000000010/mark-paid', permissions: ['HR_PAYROLL:PAY'],
      body: { payrollResultIds: ['682000000000000000000011'], expectedVersion: 1 },
    });

    expect([listed.statusCode, run.statusCode, finalized.statusCode, paid.statusCode]).toEqual([200, 201, 200, 200]);
  });

  test('rejects invalid payroll periods, versions, result IDs, and integer adjustment money', async () => {
    const invalidRun = await request(createServer(), {
      method: 'POST', path: '/payrolls/run', permissions: ['HR_PAYROLL:WRITE'], body: { month: 13, year: 2026 },
    });
    const invalidFinalize = await request(createServer(), {
      method: 'POST', path: '/payrolls/682000000000000000000010/finalize', permissions: ['HR_PAYROLL:FINALIZE'], body: { expectedVersion: -1 },
    });
    const invalidPaid = await request(createServer(), {
      method: 'POST', path: '/payrolls/682000000000000000000010/mark-paid', permissions: ['HR_PAYROLL:PAY'],
      body: { payrollResultIds: ['bad'], expectedVersion: 1 },
    });
    const invalidAdjustment = await request(createServer(), {
      method: 'POST', path: '/payroll-adjustments', permissions: ['HR_PAYROLL:WRITE'],
      body: { profileId: '682000000000000000000011', month: 7, year: 2026, type: 'EARNING', code: 'BONUS', name: 'Bonus', amount: 1.5 },
    });

    expect([invalidRun.statusCode, invalidFinalize.statusCode, invalidPaid.statusCode, invalidAdjustment.statusCode]).toEqual([400, 400, 400, 400]);
    expect(payrollService.calculatePayroll).not.toHaveBeenCalled();
    expect(payrollService.finalizePayroll).not.toHaveBeenCalled();
    expect(payrollService.markPayrollPaid).not.toHaveBeenCalled();
  });

  test('allows an authenticated employee to read only the me endpoint without payroll-admin permission', async () => {
    payrollService.listMyPayrollResults.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0 } });

    const mine = await request(createServer(), { method: 'GET', path: '/payrolls/me?page=1&limit=20' });
    const all = await request(createServer(), { method: 'GET', path: '/payrolls' });

    expect(mine.statusCode).toBe(200);
    expect(all.statusCode).toBe(403);
    expect(payrollService.listMyPayrollResults).toHaveBeenCalledWith(
      { page: 1, limit: 20 }, expect.objectContaining({ accountId: '682000000000000000000001' }),
    );
  });

  test('keeps literal payroll result routes ahead of the payroll run id route', async () => {
    payrollService.listPayrollResults.mockResolvedValue({ items: [], summary: {}, pagination: { page: 1, limit: 20, total: 0 } });
    payrollService.getPayrollResult.mockResolvedValue({ id: '682000000000000000000011' });

    const denied = await request(createServer(), { method: 'GET', path: '/payrolls/results?year=2026&month=7' });
    const listed = await request(createServer(), {
      method: 'GET', path: '/payrolls/results?year=2026&month=7&page=2', permissions: ['HR_PAYROLL:READ'],
    });
    const detail = await request(createServer(), {
      method: 'GET', path: '/payrolls/results/682000000000000000000011', permissions: ['HR_PAYROLL:READ'],
    });

    expect(denied.statusCode).toBe(403);
    expect(listed.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    expect(payrollService.listPayrollResults).toHaveBeenCalledWith(
      { year: 2026, month: 7, page: 2 }, expect.objectContaining({ permissions: ['HR_PAYROLL:READ'] }),
    );
    expect(payrollService.getPayrollResult).toHaveBeenCalledWith(
      '682000000000000000000011', expect.objectContaining({ permissions: ['HR_PAYROLL:READ'] }),
    );
  });
});
