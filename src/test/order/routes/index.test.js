const http = require('http');
const express = require('express');
const orderRouter = require('../../../modules/order/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const orderQueryService = require('../../../modules/order/services/orderQuery.service');

jest.mock('../../../modules/order/services/orderQuery.service');

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

function request(server, { method, path }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ method, port, path }, (res) => {
        let responseBody = '';

        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          server.close(() => {
            resolve({
              statusCode: res.statusCode,
              body: responseBody ? JSON.parse(responseBody) : null,
            });
          });
        });
      });

      req.on('error', (error) => {
        server.close(() => reject(error));
      });

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
});
