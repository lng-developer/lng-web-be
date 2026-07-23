const http = require('http');
const express = require('express');
const financeRouter = require('../../../modules/finance/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const service = require('../../../modules/finance/services/financeSnapshot.service');
const importService = require('../../../modules/finance/services/financeImport.service');

jest.mock('../../../modules/finance/services/financeSnapshot.service');
jest.mock('../../../modules/finance/services/financeImport.service');

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
  method, path, headers = {}, body, rawBody,
}) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const payload = rawBody || (body ? JSON.stringify(body) : undefined);
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: {
          ...(payload && body ? { 'Content-Type': 'application/json' } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
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

  test('POST recalculate order requires FINANCE:WRITE', async () => {
    service.recalculateOrder.mockResolvedValue({
      orderId,
      itemCount: 2,
      recalculatedCount: 2,
      missingCostCount: 0,
      summary: { revenueAmount: 1000, baseCostAmount: 400, grossProfitAmount: 500 },
    });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/orders/${orderId}/recalculate`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/orders/${orderId}/recalculate`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:WRITE'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.recalculateOrder).toHaveBeenCalledWith(orderId, {
      permissions: ['FINANCE:WRITE'],
    });
  });

  test('POST recalculate order rejects invalid order id', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/orders/not-an-object-id/recalculate',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:WRITE'] }) },
    });

    expect(response.statusCode).toBe(400);
    expect(service.recalculateOrder).not.toHaveBeenCalled();
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

  test('POST import transactions requires FINANCE:WRITE and accepts multipart file', async () => {
    importService.importTransactionsFromFile.mockResolvedValue({
      dryRun: true,
      processedRows: 1,
      validRows: 1,
      skippedRows: 0,
      upserted: {},
      unlinkedRows: 0,
      errors: [],
    });
    const shopId = '660000000000000000140003';
    const boundary = '----financetest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="transaction.csv"',
      'Content-Type: text/csv',
      '',
      '"date/time","settlement id","type","order id","sku","selling fees"',
      '"Apr 15, 2026 3:48:00 AM PDT","262","Order","114-1","SKU-1","-3.25"',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/imports/transactions?shopId=${shopId}&salesChannelCode=AMAZON&marketplaceCode=AMAZON_US`,
      headers: {
        'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      rawBody,
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/imports/transactions?shopId=${shopId}&salesChannelCode=AMAZON&marketplaceCode=AMAZON_US&dryRun=true`,
      headers: {
        'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:WRITE'] }),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      rawBody,
    });
    expect(allowed.statusCode).toBe(200);
    expect(importService.importTransactionsFromFile).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringMatching(/transaction|lng-finance-imports/),
      originalname: 'transaction.csv',
      mimetype: 'text/csv',
    }), {
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      dryRun: true,
      sourceRef: 'transaction.csv',
    }, { permissions: ['FINANCE:WRITE'] });
  });

  test('GET import batches requires FINANCE:READ and forwards validated pagination filters', async () => {
    importService.listImportBatches.mockResolvedValue({
      items: [], total: 0, page: 2, limit: 10,
    });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/import-batches',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/import-batches?sourceType=ads&status=completed&page=2&limit=10',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body.data).toEqual({
      items: [], total: 0, page: 2, limit: 10,
    });
    expect(importService.listImportBatches).toHaveBeenCalledWith({
      sourceType: 'ADS', status: 'COMPLETED', page: 2, limit: 10,
    }, { permissions: ['FINANCE:READ'] });
  });

  test('GET import batch detail requires FINANCE:READ', async () => {
    const batchId = '660000000000000000140004';
    importService.getImportBatch.mockResolvedValue({ id: batchId, status: 'COMPLETED' });

    const response = await request(createServer(), {
      method: 'GET',
      path: `/import-batches/${batchId}`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(importService.getImportBatch).toHaveBeenCalledWith(batchId, { permissions: ['FINANCE:READ'] });
  });

  test('POST import batch reprocess requires FINANCE:WRITE', async () => {
    const batchId = '660000000000000000140005';
    importService.retryImportBatch.mockResolvedValue({ id: '660000000000000000140006', status: 'COMPLETED' });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/import-batches/${batchId}/reprocess`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/import-batches/${batchId}/reprocess`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:WRITE'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(importService.retryImportBatch).toHaveBeenCalledWith(batchId, { permissions: ['FINANCE:WRITE'] });
  });

  test('GET imported data validates source type and returns paginated source rows', async () => {
    importService.listImportedData.mockResolvedValue({
      items: [], total: 0, page: 1, limit: 20,
    });

    const invalid = await request(createServer(), {
      method: 'GET',
      path: '/imported-data/invalid',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });
    expect(invalid.statusCode).toBe(400);
    expect(importService.listImportedData).not.toHaveBeenCalled();

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/imported-data/transactions?shopId=660000000000000000140003&page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['FINANCE:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body.data).toEqual({
      items: [], total: 0, page: 1, limit: 20,
    });
    expect(importService.listImportedData).toHaveBeenCalledWith('transactions', {
      shopId: '660000000000000000140003', page: 1, limit: 20,
    }, { permissions: ['FINANCE:READ'] });
  });
});
