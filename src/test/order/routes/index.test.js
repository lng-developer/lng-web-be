const http = require('http');
const express = require('express');
const orderRouter = require('../../../modules/order/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const orderQueryService = require('../../../modules/order/services/orderQuery.service');
const orderOperationsService = require('../../../modules/order/services/orderOperations.service');
const { toOrderDto } = require('../../../modules/order/dtos/order.dto');

jest.mock('../../../modules/order/services/orderQuery.service');
jest.mock('../../../modules/order/services/orderOperations.service');

jest.mock('../../../modules/auth/public', () => ({
  authenticate: (req, res, next) => {
    req.auth = { permissions: ['ORDERS:READ'], scopes: [] };
    next();
  },
  authorizeAnyPermission: () => (req, res, next) => next(),
}));

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use(orderRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const { port } = server.address();
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        method,
        port,
        path,
        headers: payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {},
      }, (res) => {
        let responseBody = '';

        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          server.close(() => {
            let parsedBody = null;
            try {
              parsedBody = responseBody ? JSON.parse(responseBody) : null;
            } catch (error) {
              parsedBody = responseBody;
            }

            resolve({
              statusCode: res.statusCode,
              body: parsedBody,
            });
          });
        });
      });

      req.on('error', (error) => {
        server.close(() => reject(error));
      });

      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('order routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /summary returns order tab counts', async () => {
    orderQueryService.getOrderSummary.mockResolvedValue({ tabCounts: { ALL: 2, NEW_ORDER: 1 } });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/summary?dateFrom=2026-06-01T00:00:00.000Z&dateTo=2026-06-30T23:59:59.000Z',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { tabCounts: { ALL: 2, NEW_ORDER: 1 } },
    });
    expect(orderQueryService.getOrderSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: new Date('2026-06-01T00:00:00.000Z'),
        dateTo: new Date('2026-06-30T23:59:59.000Z'),
      }),
      expect.objectContaining({ permissions: ['ORDERS:READ'] }),
    );
  });

  test('GET /counts aliases order tab counts', async () => {
    orderQueryService.getOrderSummary.mockResolvedValue({ tabCounts: { ALL: 2, NEW_ORDER: 1 } });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/counts?search=nurse',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { tabCounts: { ALL: 2, NEW_ORDER: 1 } },
    });
    expect(orderQueryService.getOrderSummary).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'nurse' }),
      expect.objectContaining({ permissions: ['ORDERS:READ'] }),
    );
  });

  test('GET /header is removed', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/header',
    });

    expect(response.statusCode).toBe(400);
    expect(orderQueryService.getOrderSummary).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('GET /:orderId/expanded returns slim customization view without payload internals', async () => {
    const orderId = '660000000000000000000301';
    orderQueryService.getExpandedOrder.mockResolvedValue({
      order: {
        _id: orderId,
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        externalAccountId: 'SELLER-1',
        externalOrderId: '114-1',
        status: 'IMPORTED',
        externalData: { amazon: { shouldNotLeak: true, isPrime: 'TRUE' } },
        importedAt: '2026-06-30T06:51:17.931Z',
      },
      items: [{
        item: {
          _id: '660000000000000000000401',
          orderId,
          salesChannelCode: 'AMAZON',
          asin: 'B000TEST01',
          title: 'Custom Shirt',
          customizationRawSummary: {
            customizedUrl: 'https://zme-caps.amazon.com/t/token?secret=do-not-leak',
          },
          externalData: { amazon: { shouldNotLeak: true, giftMessageText: 'Happy birthday' } },
          importedAt: '2026-06-30T06:51:17.931Z',
        },
        customization: {
          payloadId: '660000000000000000000501',
          status: 'PARSED',
          needsReview: false,
          errorCode: null,
          errorMessage: null,
          customerInputs: { texts: [{ label: 'Custom Name', value: 'NURSE' }] },
          imageAssets: [{ secureUrl: 'https://res.cloudinary.com/demo/front.jpg' }],
          failedImages: [],
        },
        fulfillmentPlan: {
          costEstimate: {
            currency: 'USD',
            totalAmount: 1894,
            lines: [{ code: 'BASE_COST', label: 'Base cost', amount: 1200 }],
            signals: { configCode: 'TS1S', twoSided: false, embroidery: false, priority: true },
          },
        },
        production: {
          id: '660000000000000000000601',
          productionStatus: 'BLOCKED',
          scaleStatus: 'NEED_SCALE',
          qcStatus: 'NOT_READY',
          blockers: ['PSD_MISSING'],
        },
      }],
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: `/${orderId}/expanded`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.platform).toEqual({
      channel: 'AMAZON',
      marketplace: 'AMAZON_US',
      sellerAccountId: 'SELLER-1',
      flags: expect.objectContaining({ isPrime: true }),
    });
    expect(response.body.data.items[0].platform).toEqual({
      channel: 'AMAZON',
      asin: 'B000TEST01',
      externalListingId: null,
      externalProductId: null,
      externalVariantId: null,
      flags: expect.objectContaining({ hasGiftMessage: true }),
    });
    expect(response.body.data.items[0].customization).toEqual({
      payloadId: '660000000000000000000501',
      status: 'PARSED',
      needsReview: false,
      errorCode: null,
      errorMessage: null,
      customerInputs: { texts: [{ label: 'Custom Name', value: 'NURSE' }] },
      imageAssets: [{ secureUrl: 'https://res.cloudinary.com/demo/front.jpg' }],
      failedImages: [],
    });
    expect(response.body.data.items[0].pricing).toEqual(expect.objectContaining({
      baseCostAmount: 1894,
      baseCostStatus: 'PRESENT',
      costEstimate: expect.objectContaining({ totalAmount: 1894 }),
    }));
    expect(response.body.data.items[0].production).toEqual({
      taskId: '660000000000000000000601',
      status: 'BLOCKED',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      blockers: ['PSD_MISSING'],
      assignedDesignUserId: null,
      assignedAt: null,
      designNote: null,
      designAssignmentStatus: null,
      readyAt: null,
      sentToVendorAt: null,
    });
    expect(JSON.stringify(response.body)).not.toContain('rawRecordId');
    expect(JSON.stringify(response.body)).not.toContain('parsedData');
    expect(JSON.stringify(response.body)).not.toContain('downloadedZip');
    expect(JSON.stringify(response.body)).not.toContain('zipInspection');
    expect(JSON.stringify(response.body)).not.toContain('assets');
    expect(JSON.stringify(response.body)).not.toContain('externalData');
    expect(JSON.stringify(response.body)).not.toContain('customizationRawSummary');
    expect(JSON.stringify(response.body)).not.toContain('do-not-leak');
    expect(JSON.stringify(response.body)).not.toContain('importedAt');
  });

  test('PATCH order page actions return updated order dto', async () => {
    const orderId = '660000000000000000000301';
    orderOperationsService.updateBuyer.mockResolvedValue({
      _id: orderId,
      buyer: { name: 'Buyer' },
      status: 'IMPORTED',
    });
    orderOperationsService.updateShippingService.mockResolvedValue({
      _id: orderId,
      shippingService: { level: 'Express' },
      status: 'IMPORTED',
    });
    orderOperationsService.updateCaseStatus.mockResolvedValue({
      _id: orderId,
      status: 'IMPORTED',
      caseStatus: 'OPEN',
    });

    const buyer = await request(createTestServer(), {
      method: 'PATCH',
      path: `/${orderId}/buyer`,
      body: { name: 'Buyer' },
    });
    const shipping = await request(createTestServer(), {
      method: 'PATCH',
      path: `/${orderId}/shipping-service`,
      body: { level: 'Express' },
    });
    const caseStatus = await request(createTestServer(), {
      method: 'PATCH',
      path: `/${orderId}/case-status`,
      body: { caseStatus: 'OPEN' },
    });

    expect(buyer.statusCode).toBe(200);
    expect(shipping.statusCode).toBe(200);
    expect(caseStatus.statusCode).toBe(200);
    expect(orderOperationsService.updateBuyer).toHaveBeenCalledWith(orderId, { name: 'Buyer' }, expect.any(Object));
    expect(orderOperationsService.updateShippingService).toHaveBeenCalledWith(orderId, { level: 'Express' }, expect.any(Object));
    expect(orderOperationsService.updateCaseStatus).toHaveBeenCalledWith(orderId, 'OPEN', expect.any(Object));
    expect(caseStatus.body.data).toEqual(toOrderDto({
      _id: orderId,
      status: 'IMPORTED',
      caseStatus: 'OPEN',
    }));
  });

  test('PATCH /:orderId/status is not exposed', async () => {
    const orderId = '660000000000000000000301';
    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/${orderId}/status`,
      body: { status: 'PROCESSING' },
    });

    expect(response.statusCode).toBe(404);
    expect(orderOperationsService.updateCaseStatus).not.toHaveBeenCalled();
  });
});
