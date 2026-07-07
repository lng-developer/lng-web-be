const http = require('http');
const express = require('express');
const financeRouter = require('../../../modules/finance/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const service = require('../../../modules/finance/services/financeSnapshot.service');

jest.mock('../../../modules/finance/services/financeSnapshot.service');

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
  app.use(financeRouter);
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

describe('finance routes', () => {
  const orderId = '660000000000000000140001';
  const orderItemId = '660000000000000000140002';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /snapshots requires FINANCE:READ and validates query', async () => {
    service.listSnapshots.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/snapshots',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: `/snapshots?orderId=${orderId}&snapshotStatus=estimated&page=1&limit=20`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.listSnapshots).toHaveBeenCalledWith({
      orderId,
      snapshotStatus: 'ESTIMATED',
      page: 1,
      limit: 20,
    }, { permissions: ['FINANCE:READ'] });
  });

  test('POST recalculate requires FINANCE:WRITE', async () => {
    service.recalculateOrderItem.mockResolvedValue({ orderItemId, snapshotStatus: 'ESTIMATED' });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/recalculate`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/recalculate`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:WRITE'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.recalculateOrderItem).toHaveBeenCalledWith(orderItemId, {
      permissions: ['FINANCE:WRITE'],
    });
  });

  test('GET snapshot by order item and order summary use read permission', async () => {
    service.getSnapshotByOrderItem.mockResolvedValue({ orderItemId });
    service.getOrderSummary.mockResolvedValue({ orderId, itemCount: 1 });

    const snapshot = await request(createServer(), {
      method: 'GET',
      path: `/order-items/${orderItemId}/snapshot`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });
    const summary = await request(createServer(), {
      method: 'GET',
      path: `/orders/${orderId}/summary`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });

    expect(snapshot.statusCode).toBe(200);
    expect(summary.statusCode).toBe(200);
    expect(service.getSnapshotByOrderItem).toHaveBeenCalledWith(orderItemId, { permissions: ['FINANCE:READ'] });
    expect(service.getOrderSummary).toHaveBeenCalledWith(orderId, { permissions: ['FINANCE:READ'] });
  });
});
