const http = require('http');
const express = require('express');
const vendorRouter = require('../../../modules/vendor/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const vendorService = require('../../../modules/vendor/services/vendor.service');

jest.mock('../../../modules/vendor/services/vendor.service');

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
  };
});

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(vendorRouter);
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

describe('vendor routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET / requires VENDORS:READ and passes query', async () => {
    vendorService.listVendors.mockResolvedValue({
      items: [],
      pagination: { total: 0, page: 1, limit: 20 },
    });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/?id=660000000000000000000501&providerKey=printway&page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(vendorService.listVendors).toHaveBeenCalledWith({
      id: '660000000000000000000501',
      providerKey: 'PRINTWAY',
      page: 1,
      limit: 20,
    });
  });

  test('POST / validates payload and requires VENDORS:WRITE', async () => {
    vendorService.createVendor.mockResolvedValue({
      id: '660000000000000000000501',
      code: 'PRINTWAY',
      fulfillmentType: 'POD',
    });

    const invalid = await request(createServer(), {
      method: 'POST',
      path: '/',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:WRITE'] }) },
      body: { code: 'printway', providerKey: 'BAD', fulfillmentType: 'pod' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(vendorService.createVendor).not.toHaveBeenCalled();

    const missingFulfillmentType = await request(createServer(), {
      method: 'POST',
      path: '/',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:WRITE'] }) },
      body: { code: 'printway', name: 'Printway', providerKey: 'printway' },
    });
    expect(missingFulfillmentType.statusCode).toBe(400);

    const valid = await request(createServer(), {
      method: 'POST',
      path: '/',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:WRITE'] }) },
      body: { code: 'printway', name: 'Printway', providerKey: 'printway', fulfillmentType: 'pod' },
    });
    expect(valid.statusCode).toBe(201);
    expect(vendorService.createVendor).toHaveBeenCalledWith({
      code: 'PRINTWAY',
      name: 'Printway',
      providerKey: 'PRINTWAY',
      fulfillmentType: 'POD',
    }, { permissions: ['VENDORS:WRITE'] });
  });

  test('POST /products rejects float baseCostAmount', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/products',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:WRITE'] }) },
      body: {
        vendorId: '660000000000000000000501',
        productTypeGroupId: '660000000000000000000301',
        code: 'SHIRT',
        name: 'Shirt',
        baseCostAmount: 12.34,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(vendorService.createVendorProduct).not.toHaveBeenCalled();
  });

  test('vendor integration routes require vendor permissions and validate payload', async () => {
    vendorService.updateVendorIntegrationConfig.mockResolvedValue({
      id: '660000000000000000000801',
      vendorId: '660000000000000000000501',
      providerKey: 'PRINTWAY',
      baseUrl: 'https://apis.printway.io',
      authType: 'ACCESS_REFRESH',
      status: 'CONNECTED',
      accessTokenConfigured: true,
      refreshTokenConfigured: true,
    });
    vendorService.getVendorIntegrationConfig.mockResolvedValue({
      id: '660000000000000000000801',
      vendorId: '660000000000000000000501',
      providerKey: 'PRINTWAY',
      baseUrl: 'https://apis.printway.io',
      authType: 'ACCESS_REFRESH',
      status: 'CONNECTED',
    });

    const forbidden = await request(createServer(), {
      method: 'PATCH',
      path: '/660000000000000000000501/integration',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:READ'] }) },
      body: { providerKey: 'PRINTWAY', baseUrl: 'https://apis.printway.io', authType: 'ACCESS_REFRESH' },
    });
    expect(forbidden.statusCode).toBe(403);

    const invalid = await request(createServer(), {
      method: 'PATCH',
      path: '/660000000000000000000501/integration',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:WRITE'] }) },
      body: { providerKey: 'BAD', baseUrl: 'not-a-url', authType: 'ACCESS_REFRESH' },
    });
    expect(invalid.statusCode).toBe(400);

    const updated = await request(createServer(), {
      method: 'PATCH',
      path: '/660000000000000000000501/integration',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:WRITE'] }) },
      body: {
        providerKey: 'printway',
        baseUrl: 'https://apis.printway.io',
        authType: 'access_refresh',
        accessToken: 'secret',
        refreshToken: 'refresh',
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(vendorService.updateVendorIntegrationConfig).toHaveBeenCalledWith(
      '660000000000000000000501',
      expect.objectContaining({
        providerKey: 'PRINTWAY',
        authType: 'ACCESS_REFRESH',
        accessToken: 'secret',
      }),
      { permissions: ['VENDORS:WRITE'] },
    );

    const detail = await request(createServer(), {
      method: 'GET',
      path: '/660000000000000000000501/integration',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:READ'] }) },
    });
    expect(detail.statusCode).toBe(200);
    expect(vendorService.getVendorIntegrationConfig).toHaveBeenCalledWith('660000000000000000000501');
  });

  test('cost center routes use productId from route', async () => {
    vendorService.createVendorCostCenter.mockResolvedValue({
      id: '660000000000000000000701',
      vendorProductId: '660000000000000000000601',
      code: 'BLACK_L',
      vendorSize: 'L',
      vendorColor: 'Black',
    });

    const response = await request(createServer(), {
      method: 'POST',
      path: '/products/660000000000000000000601/cost-centers',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDORS:WRITE'] }) },
      body: {
        code: 'black_l',
        name: 'Black L',
        vendorSize: 'L',
        vendorColor: 'Black',
        standardSize: 'L',
        standardColor: 'Black',
        baseCostAmount: 1200,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(vendorService.createVendorCostCenter).toHaveBeenCalledWith(
      '660000000000000000000601',
      {
        code: 'BLACK_L',
        name: 'Black L',
        vendorSize: 'L',
        vendorColor: 'Black',
        standardSize: 'L',
        standardColor: 'Black',
        baseCostAmount: 1200,
      },
      { permissions: ['VENDORS:WRITE'] },
    );
  });
});
