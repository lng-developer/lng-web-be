const http = require('http');
const express = require('express');
const catalogRouter = require('../../../modules/catalog/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const catalogService = require('../../../modules/catalog/services/catalog.service');

jest.mock('../../../modules/catalog/services/catalog.service');

jest.mock('../../../modules/auth/public', () => {
  const AppError = require('../../../shared/errors/appError');
  const httpStatus = require('../../../shared/constants/httpStatus');
  const errorCodes = require('../../../shared/constants/errorCodes');

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

  test('GET /internal-templates requires global catalog read', async () => {
    const response = await request(createServer(), {
      method: 'GET',
      path: '/internal-templates',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [], scopes: [] }) },
    });

    expect(response.statusCode).toBe(403);
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
