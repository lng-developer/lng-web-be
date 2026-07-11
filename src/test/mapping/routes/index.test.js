const http = require('http');
const express = require('express');
const mappingRouter = require('../../../modules/mapping/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const service = require('../../../modules/mapping/services/fulfillmentPlan.service');
const ruleService = require('../../../modules/mapping/services/mappingRule.service');

jest.mock('../../../modules/mapping/services/fulfillmentPlan.service');
jest.mock('../../../modules/mapping/services/mappingRule.service');

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
    authorizePermissions: (...permissions) => (req, res, next) => {
      if (permissions.every((permission) => (req.auth.permissions || []).includes(permission))) return next();
      return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
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
  app.use(mappingRouter);
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

describe('mapping routes', () => {
  const orderItemId = '660000000000000000001001';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST preview requires MAPPING:READ', async () => {
    service.previewFulfillmentPlan.mockResolvedValue({ orderItemId, ready: false });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/preview`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/preview`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.previewFulfillmentPlan).toHaveBeenCalledWith(orderItemId, {}, { permissions: ['MAPPING:READ'] });
  });

  test('POST resolve requires MAPPING:WRITE and calls auto resolver', async () => {
    service.resolveFulfillmentPlan.mockResolvedValue({ orderItemId, status: 'READY', selectionMode: 'AUTO' });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/resolve`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/resolve`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.resolveFulfillmentPlan).toHaveBeenCalledWith(orderItemId, {}, { permissions: ['MAPPING:WRITE'] });
  });

  test('POST select validates payload and requires MAPPING:WRITE', async () => {
    service.selectFulfillmentPlan.mockResolvedValue({ orderItemId, status: 'READY', selectionMode: 'MANUAL' });

    const invalid = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/select`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: { vendorProductId: 'bad' },
    });
    expect(invalid.statusCode).toBe(400);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/select`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        vendorProductId: '660000000000000000004001',
        vendorCostCenterId: '660000000000000000005001',
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.selectFulfillmentPlan).toHaveBeenCalledWith(orderItemId, {
      vendorProductId: '660000000000000000004001',
      vendorCostCenterId: '660000000000000000005001',
    }, { permissions: ['MAPPING:WRITE'] });
  });

  test('POST vendor candidate search requires MAPPING:READ and accepts partial filters', async () => {
    service.searchVendorCandidatesForOrderItem.mockResolvedValue({
      orderItemId,
      items: [],
      pagination: { total: 0, page: 1, limit: 20 },
    });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/vendor-candidates/search`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
      body: { q: 'beeful' },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/vendor-candidates/search`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
      body: { q: 'beeful', page: 1, limit: 20 },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.searchVendorCandidatesForOrderItem).toHaveBeenCalledWith(orderItemId, {
      q: 'beeful',
      includeDifferentProductType: false,
      page: 1,
      limit: 20,
    }, { permissions: ['MAPPING:READ'] });
  });

  test('normalization rule endpoints require mapping permissions', async () => {
    ruleService.listNormalizationRules.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    ruleService.createNormalizationRule.mockResolvedValue({ id: '660000000000000000010001' });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/normalization-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const listed = await request(createServer(), {
      method: 'GET',
      path: '/normalization-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(listed.statusCode).toBe(200);

    const created = await request(createServer(), {
      method: 'POST',
      path: '/normalization-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        semanticRole: 'SIZE',
        matchTarget: 'LABEL',
        matchType: 'CONTAINS',
        matchValue: 'size',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(ruleService.createNormalizationRule).toHaveBeenCalledWith(expect.objectContaining({
      semanticRole: 'SIZE',
    }), { permissions: ['MAPPING:WRITE'] });
  });

  test('semantic rule alias creates a label normalization rule', async () => {
    ruleService.createNormalizationRule.mockResolvedValue({ id: '660000000000000000010005' });

    const created = await request(createServer(), {
      method: 'POST',
      path: '/semantic-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        semanticRole: 'SIZE',
        matchValue: 'Select Your Choose Size',
      },
    });

    expect(created.statusCode).toBe(201);
    expect(ruleService.createNormalizationRule).toHaveBeenCalledWith(expect.objectContaining({
      semanticRole: 'SIZE',
      matchTarget: 'LABEL',
      matchType: 'CONTAINS',
      matchValue: 'Select Your Choose Size',
    }), { permissions: ['MAPPING:WRITE'] });
  });

  test('value alias route requires normalized value and creates a value rule', async () => {
    ruleService.createNormalizationRule.mockResolvedValue({ id: '660000000000000000010006' });

    const invalid = await request(createServer(), {
      method: 'POST',
      path: '/value-aliases',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        semanticRole: 'SIZE',
        matchValue: 'XXL',
      },
    });
    expect(invalid.statusCode).toBe(400);

    const created = await request(createServer(), {
      method: 'POST',
      path: '/value-aliases',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        semanticRole: 'SIZE',
        matchValue: 'XXL',
        normalizedValue: '2XL',
      },
    });

    expect(created.statusCode).toBe(201);
    expect(ruleService.createNormalizationRule).toHaveBeenCalledWith(expect.objectContaining({
      semanticRole: 'SIZE',
      matchTarget: 'VALUE',
      matchType: 'EXACT',
      matchValue: 'XXL',
      normalizedValue: '2XL',
    }), { permissions: ['MAPPING:WRITE'] });
  });

  test('vendor routing rule endpoints require mapping permissions', async () => {
    ruleService.listVendorRoutingRules.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    ruleService.createVendorRoutingRule.mockResolvedValue({ id: '660000000000000000010002' });
    ruleService.reorderVendorRoutingRules.mockResolvedValue({ items: [] });

    const listed = await request(createServer(), {
      method: 'GET',
      path: '/vendor-routing-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(listed.statusCode).toBe(200);

    const created = await request(createServer(), {
      method: 'POST',
      path: '/vendor-routing-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        productTypeGroupId: '660000000000000000003001',
        vendorId: '660000000000000000004001',
      },
    });
    expect(created.statusCode).toBe(201);

    const reordered = await request(createServer(), {
      method: 'PATCH',
      path: '/vendor-routing-rules/reorder',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        productTypeGroupId: '660000000000000000003001',
        vendorRanks: [
          { vendorId: '660000000000000000004001', priority: 1 },
          { vendorId: '660000000000000000004002', priority: 2 },
        ],
      },
    });
    expect(reordered.statusCode).toBe(200);
    expect(ruleService.reorderVendorRoutingRules).toHaveBeenCalledWith(expect.objectContaining({
      productTypeGroupId: '660000000000000000003001',
    }), { permissions: ['MAPPING:WRITE'] });
  });

  test('sku config rule endpoints require mapping permissions', async () => {
    ruleService.listSkuConfigRules.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    ruleService.createSkuConfigRule.mockResolvedValue({ id: '660000000000000000010003', configCode: 'WT' });

    const listed = await request(createServer(), {
      method: 'GET',
      path: '/sku-config-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(listed.statusCode).toBe(200);

    const created = await request(createServer(), {
      method: 'POST',
      path: '/sku-config-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        configCode: 'WT',
        productTypeGroupId: '660000000000000000003001',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(ruleService.createSkuConfigRule).toHaveBeenCalledWith(expect.objectContaining({
      configCode: 'WT',
    }), { permissions: ['MAPPING:WRITE'] });
  });

  test('sku normalize rule endpoints require mapping permissions', async () => {
    ruleService.listSkuNormalizeRules.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    ruleService.createSkuNormalizeRule.mockResolvedValue({ id: '660000000000000000010004', patternType: 'SEGMENT' });

    const listed = await request(createServer(), {
      method: 'GET',
      path: '/sku-normalize-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(listed.statusCode).toBe(200);

    const created = await request(createServer(), {
      method: 'POST',
      path: '/sku-normalize-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        patternType: 'SEGMENT',
        segmentIndex: 1,
        segmentRole: 'SIZE',
        appliesWhenValues: ['L'],
        outputAction: 'REMOVE_SEGMENT',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(ruleService.createSkuNormalizeRule).toHaveBeenCalledWith(expect.objectContaining({
      patternType: 'SEGMENT',
      appliesWhenValues: ['L'],
    }), { permissions: ['MAPPING:WRITE'] });
  });
});
