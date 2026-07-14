const http = require('http');
const express = require('express');
const orderRouter = require('../../../modules/order/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const orderQueryService = require('../../../modules/order/services/orderQuery.service');
const orderOperationsService = require('../../../modules/order/services/orderOperations.service');
const orderCaseService = require('../../../modules/order/services/orderCase.service');
const orderItemRecheckService = require('../../../modules/order/services/orderItemRecheck.service');
const orderReplacementService = require('../../../modules/order/services/orderReplacement.service');
const orderItemCancelService = require('../../../modules/order/services/orderItemCancel.service');
const customerExceptionService = require('../../../modules/order/services/customerException.service');
const { toOrderDto } = require('../../../modules/order/dtos/order.dto');

jest.mock('../../../modules/order/services/orderQuery.service');
jest.mock('../../../modules/order/services/orderOperations.service');
jest.mock('../../../modules/order/services/orderCase.service');
jest.mock('../../../modules/order/services/orderItemRecheck.service');
jest.mock('../../../modules/order/services/orderReplacement.service');
jest.mock('../../../modules/order/services/orderItemCancel.service');
jest.mock('../../../modules/order/services/customerException.service');

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

  test('GET /counts is removed', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/counts?search=nurse',
    });

    expect(response.statusCode).toBe(400);
    expect(orderQueryService.getOrderSummary).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('GET /workbench returns compact order workspace rows', async () => {
    orderQueryService.listOrderWorkbench.mockResolvedValue({
      items: [{
        order: {
          id: '660000000000000000000301',
          externalOrderId: '114-1',
          shopId: '660000000000000000000201',
          itemsSummary: [{ sku: 'DUPLICATE' }],
          totalAmount: 4217,
          currency: 'USD',
        },
        shop: { _id: '660000000000000000000201', name: 'Acc1', status: 'ACTIVE' },
        items: [{
          item: { id: '660000000000000000000401', sku: 'J2520-NK' },
          seller: {
            employeeCode: 'J2508',
            name: 'Nguyen Duc Son',
            accountId: '660000000000000000000901',
            email: 'hidden@example.com',
          },
          customization: {
            status: 'PARSED',
            customerInputs: {
              texts: [{ label: 'Enter Name', value: 'Hannah' }],
              options: [{ label: 'Select Size', value: 'M' }],
              images: [{ label: 'Customer Photo', assetId: 'img1', secureUrl: 'https://image.test/a.jpg', sha256: 'hidden' }],
            },
            imageAssets: [{ assetId: 'duplicate-image', secureUrl: 'https://image.test/duplicate.jpg' }],
          },
          fulfillmentPlan: {
            status: 'READY',
            selectionMode: 'AUTO',
            vendorProduct: {
              id: 'vp1',
              code: 'PRODUCT_1717',
              name: 'T-Shirt',
              vendor: { _id: 'vendor1', code: 'BEEFUL', name: 'Beeful' },
            },
            vendorCostCenter: {
              id: 'cc1',
              standardSize: 'M',
              standardColor: 'PEPPER',
              sku: 'UT-1717-PER-M',
            },
            costEstimate: { currency: 'USD', totalAmount: 1894, lines: [{ code: 'BASE_COST', amount: 894 }] },
          },
        }],
      }],
      total: 1,
      page: 1,
      limit: 20,
      tabCounts: { ALL: 1 },
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/workbench?page=1&limit=20&search=napkin',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        items: [{
          order: {
            id: '660000000000000000000301',
            externalOrderId: '114-1',
            pricing: {
              customerPaidAmount: 4217,
              baseCostAmount: 894,
              totalCostAmount: 1894,
              currency: 'USD',
              costCenterStatus: 'PRESENT',
            },
            shop: { id: '660000000000000000000201', name: 'Acc1' },
          },
          items: [{
            item: { id: '660000000000000000000401', sku: 'J2520-NK' },
            seller: { employeeCode: 'J2508', name: 'Nguyen Duc Son' },
            customization: {
              status: 'PARSED',
              inputs: [
                { type: 'TEXT', label: 'Enter Name', value: 'Hannah' },
                { type: 'OPTION', label: 'Select Size', value: 'M' },
                { type: 'IMAGE', label: 'Customer Photo', assetId: 'img1', secureUrl: 'https://image.test/a.jpg' },
              ],
            },
            mapping: {
              status: 'READY',
              selectionMode: 'AUTO',
              vendor: { id: 'vendor1', code: 'BEEFUL', name: 'Beeful' },
              vendorProduct: { id: 'vp1', code: 'PRODUCT_1717', name: 'T-Shirt' },
              vendorCostCenter: { id: 'cc1', size: 'M', color: 'PEPPER', sku: 'UT-1717-PER-M' },
            },
            pricing: {
              customerPaidAmount: 0,
              baseCostAmount: 894,
              totalCostAmount: 1894,
              currency: 'USD',
            },
          }],
        }],
        pagination: { total: 1, page: 1, limit: 20 },
      },
    });
    expect(response.body.data).not.toHaveProperty('tabCounts');
    expect(JSON.stringify(response.body)).not.toContain('itemsSummary');
    expect(response.body.data.items[0].order).not.toHaveProperty('customerPaidAmount');
    expect(response.body.data.items[0].order).not.toHaveProperty('currency');
    expect(response.body.data.items[0].order).not.toHaveProperty('assignedStaffId');
    expect(JSON.stringify(response.body)).not.toContain('imageAssets');
    expect(JSON.stringify(response.body)).not.toContain('costEstimate');
    expect(JSON.stringify(response.body)).not.toContain('"lines"');
    expect(JSON.stringify(response.body)).not.toContain('"_id"');
    expect(JSON.stringify(response.body)).not.toContain('sha256');
    expect(JSON.stringify(response.body)).not.toContain('hidden@example.com');
    expect(orderQueryService.listOrderWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, search: 'napkin' }),
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
      baseCostAmount: 1200,
      totalCostAmount: 1894,
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
      scaleBy: null,
      qcBy: null,
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

  test('POST /items/:orderItemId/recheck returns item recheck result', async () => {
    const orderItemId = '660000000000000000000401';
    orderItemRecheckService.recheckOrderItem.mockResolvedValue({
      orderItemId,
      statusBefore: 'MAPPING_PENDING',
      statusAfter: 'NEED_PRODUCTION',
      steps: {
        customization: { ok: true, status: 'PARSED' },
        mapping: { ok: true, status: 'READY', planId: '660000000000000000000501' },
        production: { ok: true, status: 'NEED_PRODUCTION', taskId: '660000000000000000000601' },
        shipment: { ok: true, status: null },
      },
      blockingReasons: [],
    });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/items/${orderItemId}/recheck`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      orderItemId,
      statusBefore: 'MAPPING_PENDING',
      statusAfter: 'NEED_PRODUCTION',
    });
    expect(orderItemRecheckService.recheckOrderItem).toHaveBeenCalledWith(
      orderItemId,
      expect.objectContaining({ permissions: ['ORDERS:READ'] }),
    );
  });

  test('POST /items/:orderItemId/replacement creates replacement item', async () => {
    const orderItemId = '660000000000000000000401';
    const replacementItemId = '660000000000000000000402';
    orderReplacementService.createReplacementForItem.mockResolvedValue({
      _id: replacementItemId,
      orderId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '112-9013479-0033845',
      externalItemId: '163152591987020634-R1',
      sku: 'J2508-TS1S-25022026-666',
      title: 'Replacement Shirt',
      quantity: 1,
      status: 'NEW',
      replacementOfOrderItemId: orderItemId,
      replacementSequence: 1,
      replacementReason: 'Wrong size',
    });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/items/${orderItemId}/replacement`,
      body: { reason: 'Wrong size', quantity: 1 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.data).toMatchObject({
      id: replacementItemId,
      externalOrderId: '112-9013479-0033845',
      externalItemId: '163152591987020634-R1',
      replacementOfOrderItemId: orderItemId,
      replacementSequence: 1,
      replacementReason: 'Wrong size',
    });
    expect(orderReplacementService.createReplacementForItem).toHaveBeenCalledWith(
      orderItemId,
      { reason: 'Wrong size', quantity: 1 },
      expect.any(Object),
    );
  });

  test('POST /items/:orderItemId/cancel cancels item with reason', async () => {
    const orderItemId = '660000000000000000000401';
    orderItemCancelService.cancelOrderItem.mockResolvedValue({
      _id: orderItemId,
      orderId: '660000000000000000000301',
      status: 'CANCELLED',
    });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/items/${orderItemId}/cancel`,
      body: { reason: 'Buyer requested cancellation' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      id: orderItemId,
      status: 'CANCELLED',
    });
    expect(orderItemCancelService.cancelOrderItem).toHaveBeenCalledWith(
      orderItemId,
      { reason: 'Buyer requested cancellation' },
      expect.any(Object),
    );
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

  test('order case CRUD routes call service', async () => {
    const orderId = '660000000000000000000301';
    const caseId = '660000000000000000000701';
    orderCaseService.listOrderCases.mockResolvedValue({
      items: [{ id: caseId, orderId, status: 'OPEN', title: 'Need replacement' }],
      total: 1,
      page: 1,
      limit: 20,
    });
    orderCaseService.createOrderCase.mockResolvedValue({ id: caseId, orderId, status: 'OPEN', title: 'Need replacement' });
    orderCaseService.resolveOrderCase.mockResolvedValue({ id: caseId, orderId, status: 'RESOLVED', title: 'Need replacement' });
    orderCaseService.addOrderCaseComment.mockResolvedValue({
      id: caseId,
      orderId,
      status: 'OPEN',
      title: 'Need replacement',
      comments: [{ body: 'Buyer confirmed', createdBy: '660000000000000000000901' }],
    });

    const list = await request(createTestServer(), {
      method: 'GET',
      path: `/cases?orderId=${orderId}&status=OPEN`,
    });
    const create = await request(createTestServer(), {
      method: 'POST',
      path: '/cases',
      body: { orderId, title: 'Need replacement', caseType: 'REPLACEMENT' },
    });
    const resolveCase = await request(createTestServer(), {
      method: 'POST',
      path: `/cases/${caseId}/resolve`,
      body: { resolutionNote: 'Done' },
    });
    const comment = await request(createTestServer(), {
      method: 'POST',
      path: `/cases/${caseId}/comments`,
      body: { body: 'Buyer confirmed' },
    });

    expect(list.statusCode).toBe(200);
    expect(create.statusCode).toBe(201);
    expect(resolveCase.statusCode).toBe(200);
    expect(comment.statusCode).toBe(201);
    expect(comment.body.data.comments).toEqual(expect.arrayContaining([
      expect.objectContaining({ body: 'Buyer confirmed' }),
    ]));
    expect(orderCaseService.listOrderCases).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      status: 'OPEN',
    }), expect.any(Object));
    expect(orderCaseService.createOrderCase).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      title: 'Need replacement',
    }), expect.any(Object));
    expect(orderCaseService.resolveOrderCase).toHaveBeenCalledWith(caseId, { resolutionNote: 'Done' }, expect.any(Object));
    expect(orderCaseService.addOrderCaseComment).toHaveBeenCalledWith(caseId, { body: 'Buyer confirmed' }, expect.any(Object));
  });

  test('GET /customer-exceptions returns live exception queue', async () => {
    customerExceptionService.listCustomerExceptions.mockResolvedValue({
      items: [{
        orderId: '660000000000000000000301',
        orderItemId: '660000000000000000000401',
        reason: 'CUSTOMIZATION_NOT_READY',
        caseType: 'CUSTOMIZATION',
        status: 'MISSING',
      }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/customer-exceptions?caseType=CUSTOMIZATION&reason=CUSTOMIZATION_NOT_READY',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items[0]).toMatchObject({
      reason: 'CUSTOMIZATION_NOT_READY',
      caseType: 'CUSTOMIZATION',
    });
    expect(customerExceptionService.listCustomerExceptions).toHaveBeenCalledWith(
      expect.objectContaining({
        caseType: 'CUSTOMIZATION',
        reason: 'CUSTOMIZATION_NOT_READY',
      }),
      expect.any(Object),
    );
  });
});
