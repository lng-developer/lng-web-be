const http = require('http');
const express = require('express');
const mappingRouter = require('../../../src/modules/mapping/routes');
const errorHandler = require('../../../src/middlewares/errorHandler');
const service = require('../../../src/modules/mapping/services/fulfillmentPlan.service');
const ruleService = require('../../../src/modules/mapping/services/mappingRule.service');
const orderPublic = require('../../../src/modules/order/public');

jest.mock('../../../src/modules/mapping/services/fulfillmentPlan.service');
jest.mock('../../../src/modules/mapping/services/mappingRule.service');
jest.mock('../../../src/modules/order/public', () => ({ requestRecheckJob: jest.fn() }));

jest.mock('../../../src/modules/auth/public', () => {
  const AppError = require('../../../src/shared/errors/appError');
  const httpStatus = require('../../../src/shared/constants/httpStatus');
  const errorCodes = require('../../../src/shared/constants/errorCodes');

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
          body: responseBody && res.headers['content-type']?.includes('application/json')
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

describe('mapping routes', () => {
  const orderItemId = '660000000000000000001001';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('authorable shops require MAPPING:WRITE and return the Mapping-owned contract', async () => {
    const data = {
      canCreateGlobal: true,
      items: [{ id: '660000000000000000000201', name: 'Alpha Shop' }],
    };
    ruleService.listAuthorableShops.mockResolvedValue(data);

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/authorable-shops',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/authorable-shops',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toEqual({ success: true, data });
    expect(ruleService.listAuthorableShops).toHaveBeenCalledWith({ permissions: ['MAPPING:WRITE'] });
  });

  test('rule evaluation endpoints require MAPPING:READ and validate SKU normalize replacements', async () => {
    const payload = {
      ruleType: 'skuNormalize',
      rule: {
        patternType: 'SEGMENT',
        segmentIndex: 0,
        segmentRole: 'CONFIG',
        appliesWhenValues: ['J2501'],
        outputAction: 'REPLACE_SEGMENT',
        replacementValue: 'J2503',
      },
      samples: ['J2501-TS1S-US-123'],
    };
    const previewResult = {
      ruleType: 'skuNormalize',
      samples: [{ input: 'J2501-TS1S-US-123', output: 'J2503-TS1S-US-123', matched: true }],
      diagnostics: [],
    };
    const conflictResult = {
      conflicts: [{ id: '660000000000000000010053', severity: 'ERROR', reason: 'EXACT_SCOPE_PATTERN', priority: 10, status: 'ACTIVE' }],
    };
    ruleService.previewRule.mockResolvedValue(previewResult);
    ruleService.findRuleConflicts.mockResolvedValue(conflictResult);

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: '/rule-preview',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
      body: payload,
    });
    expect(forbidden.statusCode).toBe(403);

    const invalid = await request(createServer(), {
      method: 'POST',
      path: '/rule-preview',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
      body: {
        ...payload,
        rule: { ...payload.rule, replacementValue: '' },
      },
    });
    expect(invalid.statusCode).toBe(400);

    const preview = await request(createServer(), {
      method: 'POST',
      path: '/rule-preview',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
      body: payload,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body.data).toEqual(previewResult);
    expect(ruleService.previewRule).toHaveBeenCalledWith(payload, { permissions: ['MAPPING:READ'] });

    const conflicts = await request(createServer(), {
      method: 'POST',
      path: '/rule-conflicts',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
      body: payload,
    });
    expect(conflicts.statusCode).toBe(200);
    expect(conflicts.body.data).toEqual(conflictResult);
    expect(ruleService.findRuleConflicts).toHaveBeenCalledWith(payload, { permissions: ['MAPPING:READ'] });
  });

  test('rule history requires MAPPING:READ and forwards the authenticated scope', async () => {
    ruleService.listRuleHistory.mockResolvedValue({ items: [{ event: 'STATUS_CHANGED' }] });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/skuNormalize/660000000000000000010004/history',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/skuNormalize/660000000000000000010004/history',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(ruleService.listRuleHistory).toHaveBeenCalledWith(
      'skuNormalize',
      '660000000000000000010004',
      { permissions: ['MAPPING:READ'] },
    );
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
    expect(service.previewFulfillmentPlan).toHaveBeenCalledWith(orderItemId, { includeCandidates: false }, { permissions: ['MAPPING:READ'] });

    const expanded = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/preview`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
      body: { includeCandidates: true },
    });
    expect(expanded.statusCode).toBe(200);
    expect(service.previewFulfillmentPlan).toHaveBeenLastCalledWith(orderItemId, { includeCandidates: true }, { permissions: ['MAPPING:READ'] });
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

  test('deprecated config workbench route is unavailable', async () => {
    const response = await request(createServer(), {
      method: 'GET',
      path: '/config-workbench?shopId=660000000000000000000201&sampleLimit=5',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });

    expect(response.statusCode).toBe(404);
  });

  test('GET summary requires MAPPING:READ', async () => {
    service.summarizeMapping.mockResolvedValue({ totalPlanCount: 0, byStatus: {} });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/summary',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/summary?shopId=660000000000000000000201&limit=10',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.summarizeMapping).toHaveBeenCalledWith(expect.objectContaining({
      shopId: '660000000000000000000201',
      limit: 10,
    }), { permissions: ['MAPPING:READ'] });
  });

  test('GET unmatched order items requires MAPPING:READ and passes pagination filters', async () => {
    service.listUnmatchedOrderItems.mockResolvedValue({
      items: [],
      pagination: { total: 0, page: 2, limit: 10 },
    });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/order-items/unmatched',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/order-items/unmatched?page=2&limit=10&includePreview=true',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.listUnmatchedOrderItems).toHaveBeenCalledWith(expect.objectContaining({
      includePreview: true,
      limit: 10,
      page: 2,
    }), { permissions: ['MAPPING:READ'] });
  });

  test('POST recheck requires MAPPING:WRITE and queues a mapping job', async () => {
    orderPublic.requestRecheckJob.mockResolvedValue({ id: 'job-1', status: 'QUEUED' });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/recheck`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/recheck`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
    });
    expect(allowed.statusCode).toBe(202);
    expect(orderPublic.requestRecheckJob).toHaveBeenCalledWith(
      orderItemId,
      'MAPPING',
      { permissions: ['MAPPING:WRITE'] },
    );
  });

  test('POST batch recheck requires MAPPING:WRITE', async () => {
    service.recheckUnmatchedFulfillmentPlans.mockResolvedValue({
      checked: 0,
      resolved: 0,
      blocked: 0,
      skippedExisting: 0,
      items: [],
    });

    const forbidden = await request(createServer(), {
      method: 'POST',
      path: '/recheck-unmatched',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
      body: { limit: 10 },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'POST',
      path: '/recheck-unmatched',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: { limit: 10 },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.recheckUnmatchedFulfillmentPlans).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
    }), { permissions: ['MAPPING:WRITE'] });
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

  test('deprecated confirm alias is unavailable', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/confirm`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        vendorProductId: '660000000000000000004001',
        vendorCostCenterId: '660000000000000000005001',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(service.selectFulfillmentPlan).not.toHaveBeenCalled();
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
      includeTotal: true,
      includeDifferentProductType: false,
      manualBrowse: false,
      page: 1,
      limit: 20,
    }, { permissions: ['MAPPING:READ'] });
  });

  test('manual fulfillment lookup exposes staged vendor, product, and option endpoints', async () => {
    const vendorId = '660000000000000000004001';
    const productId = '660000000000000000004002';
    const productTypeGroupId = '660000000000000000003001';
    service.searchManualVendors.mockResolvedValue({ items: [], hasMore: false });
    service.listManualVendorProducts.mockResolvedValue([]);
    service.getManualVendorProductOptions.mockResolvedValue({
      dimensions: { hasSize: false, hasColor: true },
      options: { sizes: [], colors: ['Black'] },
      candidates: [],
    });
    const headers = { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) };

    expect((await request(createServer(), {
      method: 'GET', path: '/vendors?q=MangoTee', headers,
    })).statusCode).toBe(200);
    expect(service.searchManualVendors).toHaveBeenCalledWith({ q: 'MangoTee', limit: 20 });

    expect((await request(createServer(), {
      method: 'GET', path: `/vendors/${vendorId}/products?productTypeGroupId=${productTypeGroupId}`, headers,
    })).statusCode).toBe(200);
    expect(service.listManualVendorProducts).toHaveBeenCalledWith(vendorId, { productTypeGroupId });

    expect((await request(createServer(), {
      method: 'GET', path: `/vendor-products/${productId}/options?color=Black`, headers,
    })).statusCode).toBe(200);
    expect(service.getManualVendorProductOptions).toHaveBeenCalledWith(productId, {
      color: 'Black',
    });
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
    ruleService.listNormalizationRules.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });

    const listed = await request(createServer(), {
      method: 'GET',
      path: '/semantic-rules?status=ACTIVE',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });

    expect(listed.statusCode).toBe(200);
    expect(ruleService.listNormalizationRules).toHaveBeenCalledWith(expect.objectContaining({
      matchTarget: 'LABEL',
      status: 'ACTIVE',
    }), { permissions: ['MAPPING:READ'] });

    const created = await request(createServer(), {
      method: 'POST',
      path: '/semantic-rules',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:WRITE'] }) },
      body: {
        semanticRole: 'SIZE',
        matchValues: ['Select Your Choose Size', 'SizeKey'],
      },
    });

    expect(created.statusCode).toBe(201);
    expect(ruleService.createNormalizationRule).toHaveBeenCalledWith(expect.objectContaining({
      semanticRole: 'SIZE',
      matchTarget: 'LABEL',
      matchType: 'CONTAINS',
      matchValues: ['Select Your Choose Size', 'SizeKey'],
    }), { permissions: ['MAPPING:WRITE'] });
  });

  test('value alias route requires normalized value and creates a value rule', async () => {
    ruleService.createNormalizationRule.mockResolvedValue({ id: '660000000000000000010006' });
    ruleService.listNormalizationRules.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });

    const listed = await request(createServer(), {
      method: 'GET',
      path: '/value-aliases?status=ACTIVE',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['MAPPING:READ'] }) },
    });

    expect(listed.statusCode).toBe(200);
    expect(ruleService.listNormalizationRules).toHaveBeenCalledWith(expect.objectContaining({
      hasNormalizedValue: true,
      matchTarget: 'VALUE',
      status: 'ACTIVE',
    }), { permissions: ['MAPPING:READ'] });

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
