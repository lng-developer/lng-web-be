const http = require('http');
const express = require('express');
const shipmentRouter = require('../../../modules/shipment/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const service = require('../../../modules/shipment/services/shipment.service');
const webhookService = require('../../../modules/shipment/services/shipmentWebhook.service');

jest.mock('../../../modules/shipment/services/shipment.service');
jest.mock('../../../modules/shipment/services/shipmentWebhook.service');

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
      const grantedPermissions = [
        ...(req.auth.permissions || []),
        ...(req.auth.scopes || []).flatMap((scope) => scope.permissions || []),
      ];
      if (permissions.some((permission) => grantedPermissions.includes(permission))) return next();
      return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
    },
  };
});

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(shipmentRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, {
  method, path, headers = {}, body,
}) {
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

describe('shipment routes', () => {
  const shipmentId = '660000000000000000130001';
  const vendorSubmissionId = '660000000000000000130002';
  const orderItemId = '660000000000000000130004';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET / requires SHIPMENTS:READ and passes query', async () => {
    service.listShipments.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/?status=shipped&page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.listShipments).toHaveBeenCalledWith({
      status: 'SHIPPED',
      page: 1,
      limit: 20,
    }, { permissions: ['SHIPMENTS:READ'] });
  });

  test('GET /summary requires SHIPMENTS:READ', async () => {
    service.summarizeShipments.mockResolvedValue({ total: 0, byStatus: {}, byCarrier: [] });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/summary',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/summary?status=shipped&carrier=USPS',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.summarizeShipments).toHaveBeenCalledWith({
      status: 'SHIPPED',
      carrier: 'USPS',
    }, { permissions: ['SHIPMENTS:READ'] });
  });

  test('POST create from vendor submission requires SHIPMENTS:WRITE', async () => {
    service.createFromVendorSubmission.mockResolvedValue({ id: shipmentId, status: 'TRACKING_PENDING' });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/from-vendor-submissions/${vendorSubmissionId}`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:READ'] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/from-vendor-submissions/${vendorSubmissionId}`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:WRITE'] }) },
    });
    expect(allowed.statusCode).toBe(201);
    expect(service.createFromVendorSubmission).toHaveBeenCalledWith(vendorSubmissionId, {
      permissions: ['SHIPMENTS:WRITE'],
    });
  });

  test('POST vendor tracking recheck requires SHIPMENTS:WRITE and calls service', async () => {
    service.recheckVendorTracking.mockResolvedValue({
      applied: false,
      tracking: { provider: 'PRINTWAY', trackingNumber: '9214490416422001622522' },
    });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: '/vendor-tracking/recheck',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:READ'] }) },
      body: { provider: 'MERCHIZE', externalOrderId: '112-7237034-7096265' },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: '/vendor-tracking/recheck',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:WRITE'] }) },
      body: {
        provider: 'printway',
        externalOrderId: '4095267035',
        dateFrom: '2026-06-01',
        dateTo: '2026-07-17',
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.recheckVendorTracking).toHaveBeenCalledWith({
      provider: 'PRINTWAY',
      externalOrderId: '4095267035',
      dateFrom: new Date('2026-06-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-17T00:00:00.000Z'),
    }, { permissions: ['SHIPMENTS:WRITE'] });
  });

  test('POST vendor tracking recheck rejects unsupported provider before service call', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/vendor-tracking/recheck',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:WRITE'] }) },
      body: { provider: 'ONOSPOD', externalOrderId: '112-7237034-7096265' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.recheckVendorTracking).not.toHaveBeenCalled();
  });

  test('POST submitted vendor tracking recheck requires SHIPMENTS:WRITE and caps limit', async () => {
    service.recheckSubmittedVendorTracking.mockResolvedValue({
      checked: 0,
      applied: 0,
      skipped: 0,
      failed: 0,
      items: [],
    });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: '/vendor-tracking/recheck-submitted',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:READ'] }) },
      body: { provider: 'PRINTWAY', limit: 50 },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: '/vendor-tracking/recheck-submitted',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:WRITE'] }) },
      body: { provider: 'printway', limit: 500 },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.recheckSubmittedVendorTracking).toHaveBeenCalledWith({
      provider: 'PRINTWAY',
      limit: 100,
    }, { permissions: ['SHIPMENTS:WRITE'] });
  });

  test('GET by order item returns shipment for item', async () => {
    service.getShipmentByOrderItem.mockResolvedValue({ id: shipmentId, orderItemId });

    const response = await request(createServer(), {
      method: 'GET',
      path: `/order-items/${orderItemId}`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:READ'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(service.getShipmentByOrderItem).toHaveBeenCalledWith(orderItemId, { permissions: ['SHIPMENTS:READ'] });
  });

  test('PATCH tracking validates required payload', async () => {
    const invalid = await request(createServer(), {
      method: 'PATCH',
      path: `/${shipmentId}/tracking`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:WRITE'] }) },
      body: { carrier: '', trackingNumber: '' },
    });

    expect(invalid.statusCode).toBe(400);
    expect(service.updateTracking).not.toHaveBeenCalled();
  });

  test('PATCH status validates allowed status and calls service', async () => {
    service.updateStatus.mockResolvedValue({ id: shipmentId, status: 'DELIVERED' });

    const response = await request(createServer(), {
      method: 'PATCH',
      path: `/${shipmentId}/status`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:WRITE'] }) },
      body: { status: 'delivered' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.updateStatus).toHaveBeenCalledWith(shipmentId, { status: 'DELIVERED' }, {
      permissions: ['SHIPMENTS:WRITE'],
    });
  });

  test('vendor webhook receive is public but requires webhook secret in service', async () => {
    webhookService.receiveVendorWebhook.mockResolvedValue({
      statusCode: 202,
      data: { reason: 'SUBMISSION_NOT_FOUND' },
    });

    const response = await request(createServer(), {
      method: 'POST',
      path: '/vendor-webhooks/printway',
      body: { trackingNumber: '9400111899223850000001' },
    });

    expect(response.statusCode).toBe(202);
    expect(webhookService.receiveVendorWebhook).toHaveBeenCalledWith('printway', expect.objectContaining({
      body: { trackingNumber: '9400111899223850000001' },
    }));
  });

  test('vendor webhook logs require SHIPMENTS:READ', async () => {
    webhookService.listWebhookLogs.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/vendor-webhooks/logs',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/vendor-webhooks/logs?provider=printway&outcome=success',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(webhookService.listWebhookLogs).toHaveBeenCalledWith({
      provider: 'PRINTWAY',
      outcome: 'SUCCESS',
    }, { permissions: ['SHIPMENTS:READ'] });
  });

  test('vendor webhook logs allow SHIPMENTS:WRITE', async () => {
    webhookService.listWebhookLogs.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });

    const response = await request(createServer(), {
      method: 'GET',
      path: '/vendor-webhooks/logs',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['SHIPMENTS:WRITE'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(webhookService.listWebhookLogs).toHaveBeenCalledWith({}, { permissions: ['SHIPMENTS:WRITE'] });
  });

  test('vendor webhook logs forwards scoped read authorization', async () => {
    webhookService.listWebhookLogs.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    const auth = {
      permissions: [],
      scopes: [{
        scopeType: 'shop',
        scopeId: '660000000000000000130005',
        permissions: ['SHIPMENTS:READ'],
      }],
    };

    const response = await request(createServer(), {
      method: 'GET',
      path: '/vendor-webhooks/logs',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(response.statusCode).toBe(200);
    expect(webhookService.listWebhookLogs).toHaveBeenCalledWith({}, auth);
  });
});
