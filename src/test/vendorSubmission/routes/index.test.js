const http = require('http');
const express = require('express');
const vendorSubmissionRouter = require('../../../modules/vendorSubmission/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const service = require('../../../modules/vendorSubmission/services/vendorSubmission.service');

jest.mock('../../../modules/vendorSubmission/services/vendorSubmission.service');

jest.mock('../../../modules/auth/public', () => {
  const AppError = require('../../../shared/errors/appError');
  const httpStatus = require('../../../shared/constants/httpStatus');
  const errorCodes = require('../../../shared/constants/errorCodes');

  return {
    authenticate: (req, res, next) => {
      req.auth = req.headers['x-auth-context']
        ? JSON.parse(req.headers['x-auth-context'])
        : { permissions: [] };
      next();
    },
    authorizeAnyPermission: (...permissions) => (req, res, next) => {
      if (permissions.some((permission) => (req.auth.permissions || []).includes(permission))) return next();
      return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
    },
  };
});

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(vendorSubmissionRouter);
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
          body: responseBody ? JSON.parse(responseBody) : null,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('vendorSubmission routes', () => {
  const submissionId = '660000000000000000120001';
  const productionTaskId = '660000000000000000120002';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET / requires VENDOR_SUBMISSIONS:READ and passes query', async () => {
    service.listSubmissions.mockResolvedValue({
      items: [],
      pagination: { total: 0, page: 1, limit: 20 },
    });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/?status=ready&page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.listSubmissions).toHaveBeenCalledWith({
      status: 'READY',
      page: 1,
      limit: 20,
    }, { permissions: ['VENDOR_SUBMISSIONS:READ'] });
  });

  test('GET /summary requires VENDOR_SUBMISSIONS:READ', async () => {
    service.summarizeSubmissions.mockResolvedValue({ total: 0, byStatus: {} });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/summary',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/summary?status=ready&shopId=660000000000000000120003',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.summarizeSubmissions).toHaveBeenCalledWith({
      status: 'READY',
      shopId: '660000000000000000120003',
    }, { permissions: ['VENDOR_SUBMISSIONS:READ'] });
  });

  test('POST create from production task requires VENDOR_SUBMISSIONS:WRITE', async () => {
    service.createFromProductionTask.mockResolvedValue({ id: submissionId, status: 'READY' });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/from-production-tasks/${productionTaskId}`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:READ'] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/from-production-tasks/${productionTaskId}`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
    });
    expect(allowed.statusCode).toBe(201);
    expect(service.createFromProductionTask).toHaveBeenCalledWith(productionTaskId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      auditContext: expect.objectContaining({ requestId: null }),
      source: 'HTTP',
    });
  });

  test('POST recheck production task uses write permission and service', async () => {
    service.recheckProductionTask.mockResolvedValue({ id: submissionId, status: 'READY' });

    const response = await request(createServer(), {
      method: 'POST',
      path: `/recheck/production-tasks/${productionTaskId}`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(service.recheckProductionTask).toHaveBeenCalledWith(productionTaskId, expect.objectContaining({
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], source: 'HTTP', auditContext: expect.objectContaining({ requestId: null }),
    }));
  });

  test('POST batch recheck ready production tasks validates options', async () => {
    service.recheckReadyProductionTasks.mockResolvedValue({
      checked: 1,
      createdOrExisting: 1,
      skipped: 0,
      items: [{ productionTaskId, submissionId, status: 'READY' }],
    });

    const response = await request(createServer(), {
      method: 'POST',
      path: '/recheck-ready-production-tasks?shopId=660000000000000000000201&limit=25',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(service.recheckReadyProductionTasks).toHaveBeenCalledWith({
      shopId: '660000000000000000000201',
      limit: 25,
    }, expect.objectContaining({
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], source: 'HTTP', auditContext: expect.objectContaining({ requestId: null }),
    }));
  });

  test('payload preview route returns service result', async () => {
    service.getPayloadPreview.mockResolvedValue({ orderItem: { sku: 'J2508-TS1S-05032026-335' } });

    const response = await request(createServer(), {
      method: 'GET',
      path: `/${submissionId}/payload-preview`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:READ'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.orderItem.sku).toBe('J2508-TS1S-05032026-335');
  });

  test('mark failed validates failure reason', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/mark-failed`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
      body: { failureReason: '  ' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  test('mark submitted and cancel require write permission', async () => {
    service.markSubmitted.mockResolvedValue({ id: submissionId, status: 'SUBMITTED' });
    service.cancel.mockResolvedValue({ id: submissionId, status: 'CANCELLED' });

    const submitted = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/mark-submitted`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
    });
    expect(submitted.statusCode).toBe(200);
    expect(service.markSubmitted).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], source: 'HTTP', auditContext: expect.objectContaining({ requestId: null }),
    }));

    const cancelled = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/cancel`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
      body: { cancelReason: 'Duplicate' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(service.cancel).toHaveBeenCalledWith(submissionId, { cancelReason: 'Duplicate' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      source: 'HTTP',
      auditContext: expect.objectContaining({ requestId: null }),
    });
  });

  test('retry failed submission requires write permission and passes reason', async () => {
    service.retry.mockResolvedValue({ id: submissionId, status: 'READY' });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/retry`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:READ'] }) },
      body: { reason: 'Retry' },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/retry`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
      body: { reason: 'Retry after payload fix' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.retry).toHaveBeenCalledWith(submissionId, {
      reason: 'Retry after payload fix',
    }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      source: 'HTTP',
      auditContext: expect.objectContaining({ requestId: null }),
    });
  });

  test('submit to vendor requires write permission and defaults to dry run', async () => {
    service.submitToVendor.mockResolvedValue({
      provider: 'MERCHIZE',
      dryRun: true,
      payload: { order_id: '113-TEST-ORDER' },
      validation: { ok: true },
    });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/submit-to-vendor`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:READ'] }) },
      body: { provider: 'MERCHIZE' },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/submit-to-vendor`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
      body: { provider: 'MERCHIZE' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.submitToVendor).toHaveBeenCalledWith(submissionId, {
      provider: 'MERCHIZE',
      dryRun: true,
    }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      source: 'HTTP',
      auditContext: expect.objectContaining({ requestId: null }),
    });
  });

  test('forwards explicit dryRun false to the submit service', async () => {
    service.submitToVendor.mockResolvedValueOnce({ status: 'SUBMITTED', provider: 'MERCHIZE' });

    const response = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/submit-to-vendor`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
      body: { provider: 'MERCHIZE', dryRun: false },
    });

    expect(response.statusCode).toBe(200);
    expect(service.submitToVendor).toHaveBeenCalledWith(submissionId, {
      provider: 'MERCHIZE',
      dryRun: false,
    }, expect.objectContaining({
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      source: 'HTTP',
      auditContext: expect.objectContaining({ requestId: null }),
    }));
  });

  test('submit to vendor derives provider when omitted', async () => {
    service.submitToVendor.mockResolvedValueOnce({ status: 'SUBMITTED', provider: 'MERCHIZE' });
    const response = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/submit-to-vendor`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
      body: { dryRun: false },
    });

    expect(response.statusCode).toBe(200);
    expect(service.submitToVendor).toHaveBeenCalledWith(submissionId, {
      dryRun: false,
    }, expect.any(Object));
  });

  test('reconciles an ambiguous submission with write permission', async () => {
    service.reconcile.mockResolvedValueOnce({ id: submissionId, status: 'SUBMITTED' });
    const response = await request(createServer(), {
      method: 'POST', path: `/${submissionId}/reconcile`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
      body: { outcome: 'REMOTE_FOUND', vendorExternalOrderId: 'MZ-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.reconcile).toHaveBeenCalledWith(submissionId, {
      outcome: 'REMOTE_FOUND', vendorExternalOrderId: 'MZ-1',
    }, expect.any(Object));
  });

  test('submit to vendor rejects an unsupported provider before the service', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: `/${submissionId}/submit-to-vendor`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
      body: { provider: 'UNKNOWN', dryRun: false },
    });

    expect(response.statusCode).toBe(400);
    expect(service.submitToVendor).not.toHaveBeenCalled();
  });
});
