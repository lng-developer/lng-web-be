const http = require('http');
const express = require('express');
const fs = require('fs');
const catalogRouter = require('../../../src/modules/catalog/routes');
const errorHandler = require('../../../src/middlewares/errorHandler');
const catalogService = require('../../../src/modules/catalog/services/catalog.service');
const mediaPublic = require('../../../src/modules/media/public');

jest.mock('../../../src/modules/catalog/services/catalog.service');
jest.mock('../../../src/modules/media/public');

jest.mock('../../../src/modules/auth/public', () => {
  const AppError = require('../../../src/shared/errors/appError');
  const httpStatus = require('../../../src/shared/constants/httpStatus');
  const errorCodes = require('../../../src/shared/constants/errorCodes');

  function granted(auth, permission) {
    return (auth.permissions || []).includes(permission)
      || (auth.scopes || []).some((scope) => (scope.permissions || []).includes(permission));
  }

  return {
    authenticate: (req, res, next) => {
      req.auth = req.headers['x-auth-context']
        ? JSON.parse(req.headers['x-auth-context'])
        : { permissions: [], scopes: [] };
      next();
    },
    authorizePermissions: (...permissions) => (req, res, next) => {
      if (permissions.every((permission) => (req.auth.permissions || []).includes(permission))) return next();
      return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
    },
    authorizeAnyPermission: (...permissions) => (req, res, next) => {
      if (permissions.some((permission) => granted(req.auth, permission))) return next();
      return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
    },
  };
});

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(catalogRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, headers = {}, body, rawBody }) {
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
          headers: res.headers,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('catalog routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /listings allows scoped catalog read and passes auth to service', async () => {
    catalogService.listListings.mockResolvedValue({
      items: [],
      pagination: { total: 0, page: 1, limit: 20 },
    });
    const auth = {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: '660000000000000000000201', permissions: ['CATALOG:READ'] }],
    };

    const response = await request(createServer(), {
      method: 'GET',
      path: '/listings?page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(response.statusCode).toBe(200);
    expect(catalogService.listListings).toHaveBeenCalledWith({ page: 1, limit: 20 }, auth);
  });

  test('GET /listing-options allows scoped catalog write and passes auth to service', async () => {
    const data = { shops: [], productTypeGroups: [], internalTemplates: [] };
    catalogService.getListingOptions.mockResolvedValue(data);
    const auth = {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: '660000000000000000000201', permissions: ['CATALOG:WRITE'] }],
    };

    const response = await request(createServer(), {
      method: 'GET',
      path: '/listing-options',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(response.statusCode).toBe(200);
    expect(catalogService.getListingOptions).toHaveBeenCalledWith(auth);
    expect(response.body.data).toEqual(data);
  });

  test('GET /listings/summary returns listing counts', async () => {
    catalogService.getListingSummary.mockResolvedValue({
      totalListingCount: 2,
      amazonListingCount: 1,
      etsyListingCount: 1,
      draftCount: 1,
      approvedCount: 1,
      rejectedCount: 0,
    });
    const auth = {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: '660000000000000000000201', permissions: ['CATALOG:READ'] }],
    };

    const response = await request(createServer(), {
      method: 'GET',
      path: '/listings/summary?shopId=660000000000000000000201',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(response.statusCode).toBe(200);
    expect(catalogService.getListingSummary).toHaveBeenCalledWith({
      shopId: '660000000000000000000201',
    }, auth);
    expect(response.body.data).toMatchObject({ totalListingCount: 2 });
  });

  test('POST /listings rejects float baseCostAmount', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/listings',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['CATALOG:WRITE'], scopes: [] }) },
      body: {
        shopId: '660000000000000000000201',
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        sku: 'SKU-1',
        title: 'Test Listing',
        productTypeGroupId: '660000000000000000000301',
        baseCostAmount: 12.34,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(catalogService.createListing).not.toHaveBeenCalled();
  });

  test('PATCH /listings/:id strips identity fields', async () => {
    catalogService.updateListing.mockResolvedValue({ id: '660000000000000000000401', title: 'Updated' });
    const response = await request(createServer(), {
      method: 'PATCH',
      path: '/listings/660000000000000000000401',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['CATALOG:WRITE'], scopes: [] }) },
      body: {
        shopId: '660000000000000000000202',
        salesChannelCode: 'ETSY',
        marketplaceCode: 'ETSY_US',
        sku: 'SKU-2',
        title: 'Updated',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(catalogService.updateListing).toHaveBeenCalledWith(
      '660000000000000000000401',
      { title: 'Updated' },
      expect.any(Object),
    );
  });

  test('POST /listings/:id/approve calls service', async () => {
    catalogService.approveListing.mockResolvedValue({
      id: '660000000000000000000401',
      qcStatus: 'APPROVED',
    });
    const auth = { permissions: ['CATALOG:WRITE'], accountId: '660000000000000000000901', scopes: [] };

    const response = await request(createServer(), {
      method: 'POST',
      path: '/listings/660000000000000000000401/approve',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(response.statusCode).toBe(200);
    expect(catalogService.approveListing).toHaveBeenCalledWith(
      '660000000000000000000401',
      auth,
    );
    expect(response.body.data.qcStatus).toBe('APPROVED');
  });

  test('POST /listings/:id/reject requires rejectionReason', async () => {
    const auth = { permissions: ['CATALOG:WRITE'], accountId: '660000000000000000000901', scopes: [] };

    const invalid = await request(createServer(), {
      method: 'POST',
      path: '/listings/660000000000000000000401/reject',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
      body: {},
    });

    expect(invalid.statusCode).toBe(400);
    expect(catalogService.rejectListing).not.toHaveBeenCalled();

    catalogService.rejectListing.mockResolvedValue({
      id: '660000000000000000000401',
      qcStatus: 'REJECTED',
      rejectionReason: 'Missing PSD',
    });
    const valid = await request(createServer(), {
      method: 'POST',
      path: '/listings/660000000000000000000401/reject',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
      body: { rejectionReason: 'Missing PSD' },
    });

    expect(valid.statusCode).toBe(200);
    expect(catalogService.rejectListing).toHaveBeenCalledWith(
      '660000000000000000000401',
      'Missing PSD',
      auth,
    );
  });

  test('GET /internal-templates allows scoped catalog read for Listing options', async () => {
    catalogService.listInternalTemplates.mockResolvedValue({
      items: [],
      pagination: { total: 0, page: 1, limit: 20 },
    });
    const auth = {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: '660000000000000000000201', permissions: ['CATALOG:READ'] }],
    };
    const response = await request(createServer(), {
      method: 'GET',
      path: '/internal-templates',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(response.statusCode).toBe(200);
    expect(catalogService.listInternalTemplates).toHaveBeenCalledWith({});
  });

  test('POST /assets uploads a template asset with global catalog write', async () => {
    mediaPublic.storeUploadedFile.mockResolvedValue({
      _id: '660000000000000000000901',
      originalFilename: 'template.psd',
      mimeType: 'application/octet-stream',
      size: 8,
    });
    const boundary = '----catalogassettest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="template.psd"',
      'Content-Type: application/octet-stream',
      '',
      'psd-data',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const response = await request(createServer(), {
      method: 'POST',
      path: '/assets',
      headers: {
        'X-Auth-Context': JSON.stringify({ permissions: ['CATALOG:WRITE'], accountId: '660000000000000000000902', scopes: [] }),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      rawBody,
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe('/api/media/assets/660000000000000000000901');
    expect(mediaPublic.storeUploadedFile).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'template.psd' }),
      { source: 'CATALOG_TEMPLATE', uploadedBy: '660000000000000000000902' },
    );
    expect(response.body.data.downloadUrl).toBe('/api/media/assets/660000000000000000000901/download');
  });

  test('GET /product-type-groups allows scoped catalog write for Listing options', async () => {
    catalogService.listProductTypeGroups.mockResolvedValue({
      items: [],
      pagination: { total: 0, page: 1, limit: 20 },
    });
    const auth = {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: '660000000000000000000201', permissions: ['CATALOG:WRITE'] }],
    };
    const response = await request(createServer(), {
      method: 'GET',
      path: '/product-type-groups',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(response.statusCode).toBe(200);
    expect(catalogService.listProductTypeGroups).toHaveBeenCalledWith({});
  });

  test('POST /internal-templates validates payload and returns DTO', async () => {
    catalogService.createInternalTemplate.mockResolvedValue({
      id: '660000000000000000000701',
      code: 'NAPKIN_MAIN',
      name: 'Napkin Main',
    });
    const response = await request(createServer(), {
      method: 'POST',
      path: '/internal-templates',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['CATALOG:WRITE'], scopes: [] }) },
      body: {
        code: 'napkin_main',
        name: 'Napkin Main',
        productTypeGroupId: '660000000000000000000301',
        requiredFields: [{ key: 'customName', type: 'TEXT' }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(catalogService.createInternalTemplate).toHaveBeenCalledWith(expect.objectContaining({
      code: 'NAPKIN_MAIN',
      requiredFields: [{ key: 'customName', type: 'TEXT' }],
    }));
  });
});
