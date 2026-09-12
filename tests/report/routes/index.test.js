const http = require('http');
const express = require('express');
const reportRouter = require('../../../src/modules/report/routes');
const errorHandler = require('../../../src/middlewares/errorHandler');
const service = require('../../../src/modules/report/services/report.service');

jest.mock('../../../src/modules/report/services/report.service');

jest.mock('../../../src/modules/auth/public', () => {
  const AppError = require('../../../src/shared/errors/appError');
  const httpStatus = require('../../../src/shared/constants/httpStatus');
  const errorCodes = require('../../../src/shared/constants/errorCodes');

  return {
    authenticate: (req, res, next) => {
      req.auth = req.headers['x-auth-context'] ? JSON.parse(req.headers['x-auth-context']) : { permissions: [] };
      next();
    },
    authorizeAnyPermission:
      (...permissions) =>
      (req, res, next) => {
        const granted = [
          ...(req.auth.permissions || []),
          ...(req.auth.scopes || []).flatMap((scope) => scope.permissions || []),
        ];
        if (permissions.some((permission) => granted.includes(permission))) return next();
        return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
      },
  };
});

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(reportRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { path, headers = {} }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const req = http.request({ method: 'GET', port: server.address().port, path, headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () =>
          server.close(() => resolve({ statusCode: res.statusCode, body: body ? JSON.parse(body) : null })),
        );
      });
      req.on('error', (error) => server.close(() => reject(error)));
      req.end();
    });
  });
}

describe('report routes', () => {
  const shopId = '660000000000000000000201';
  const auth = { permissions: ['REPORTS:READ'] };
  const auditedAuth = () =>
    expect.objectContaining({ ...auth, auditContext: expect.objectContaining({ ipAddress: '::1' }) });

  beforeEach(() => {
    jest.clearAllMocks();
    service.getFinanceDaily.mockResolvedValue([]);
    service.getFinanceCoverage.mockResolvedValue([]);
    service.getFinanceDailyProfit.mockResolvedValue([]);
    service.getFinanceOrderProfitability.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    service.getFinanceBySeller.mockResolvedValue([]);
    service.getFinanceSellerDaily.mockResolvedValue([]);
    service.getFinanceByTeam.mockResolvedValue([]);
    service.getVendorPerformance.mockResolvedValue([]);
    service.getOperationsOverview.mockResolvedValue({});
    service.getBuyerInsights.mockResolvedValue({});
    service.getAdsChannelPerformance.mockResolvedValue([]);
    service.getAdsSellerAttribution = jest.fn().mockResolvedValue([]);
    service.getAdsDaily = jest.fn().mockResolvedValue([]);
    service.getAdsSellerDaily = jest.fn().mockResolvedValue([]);
    service.getFilterOptions = jest.fn().mockResolvedValue({ channels: [] });
  });

  test('GET /finance/daily requires REPORTS:READ and validates query', async () => {
    const forbidden = await request(createServer(), { path: '/finance/daily' });
    expect(forbidden.statusCode).toBe(403);

    const invalid = await request(createServer(), {
      path: '/finance/daily?shopId=bad',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });
    expect(invalid.statusCode).toBe(400);

    const allowed = await request(createServer(), {
      path: `/finance/daily?shopId=${shopId}&salesChannelCode=amazon&dateFrom=2026-07-01&dateTo=2026-07-11`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.getFinanceDaily).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId,
        salesChannelCode: 'AMAZON',
        dateBasis: 'ORDERED_AT',
        dateFrom: expect.any(Date),
        dateTo: expect.any(Date),
      }),
      auditedAuth(),
    );
  });

  test('finance reports accept an explicit calculated-at basis for technical audit', async () => {
    const allowed = await request(createServer(), {
      path: `/finance/daily?shopId=${shopId}&dateBasis=calculated_at`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(service.getFinanceDaily).toHaveBeenCalledWith(
      expect.objectContaining({ shopId, dateBasis: 'CALCULATED_AT' }),
      auditedAuth(),
    );
  });

  test('finance coverage uses the same bounded date basis as profitability reports', async () => {
    const allowed = await request(createServer(), {
      path: `/finance/coverage?shopId=${shopId}&dateBasis=calculated_at`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(service.getFinanceCoverage).toHaveBeenCalledWith(
      expect.objectContaining({ shopId, dateBasis: 'CALCULATED_AT' }),
      auditedAuth(),
    );
  });

  test('GET /filter-options requires REPORTS:READ', async () => {
    const forbidden = await request(createServer(), { path: '/filter-options' });
    const allowed = await request(createServer(), {
      path: '/filter-options',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(forbidden.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(service.getFilterOptions).toHaveBeenCalledWith(auth);
  });

  test('GET /finance/daily-profit requires REPORTS:READ and validates query', async () => {
    const forbidden = await request(createServer(), { path: '/finance/daily-profit' });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      path: `/finance/daily-profit?shopId=${shopId}&marketplaceCode=amazon_us`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(service.getFinanceDailyProfit).toHaveBeenCalledWith(
      expect.objectContaining({ shopId, marketplaceCode: 'AMAZON_US' }),
      auditedAuth(),
    );
  });

  test('order profitability keeps report permission, filter, and pagination at the API boundary', async () => {
    const forbidden = await request(createServer(), { path: '/finance/orders-profitability' });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      path: `/finance/orders-profitability?shopId=${shopId}&salesChannelCode=amazon&page=2&limit=20`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(service.getFinanceOrderProfitability).toHaveBeenCalledWith(
      expect.objectContaining({ shopId, salesChannelCode: 'AMAZON', page: 2, limit: 20 }),
      auditedAuth(),
    );
  });

  test('vendor performance and operations overview use report read permission', async () => {
    const headers = { 'X-Auth-Context': JSON.stringify(auth) };
    const vendor = await request(createServer(), { path: '/vendor/performance?page=2&limit=50', headers });
    const overview = await request(createServer(), { path: '/operations/overview', headers });

    expect(vendor.statusCode).toBe(200);
    expect(overview.statusCode).toBe(200);
    expect(service.getVendorPerformance).toHaveBeenCalledWith({ page: 2, limit: 50 }, auth);
    expect(service.getOperationsOverview).toHaveBeenCalledWith({}, auth);
  });

  test('finance seller reports use report read permission', async () => {
    const headers = { 'X-Auth-Context': JSON.stringify(auth) };
    const bySeller = await request(createServer(), { path: `/finance/by-seller?shopId=${shopId}`, headers });
    const byTeam = await request(createServer(), { path: `/finance/by-team?shopId=${shopId}`, headers });
    const sellerDaily = await request(createServer(), {
      path: `/finance/seller-daily?shopId=${shopId}&dateFrom=2026-07-01&dateTo=2026-07-11`,
      headers,
    });

    expect(bySeller.statusCode).toBe(200);
    expect(byTeam.statusCode).toBe(200);
    expect(sellerDaily.statusCode).toBe(200);
    expect(service.getFinanceBySeller).toHaveBeenCalledWith(expect.objectContaining({ shopId }), auditedAuth());
    expect(service.getFinanceByTeam).toHaveBeenCalledWith(expect.objectContaining({ shopId }), auditedAuth());
    expect(service.getFinanceSellerDaily).toHaveBeenCalledWith(
      expect.objectContaining({ shopId, dateFrom: expect.any(Date), dateTo: expect.any(Date) }),
      auditedAuth(),
    );
  });

  test('buyer insights requires REPORTS:READ and validates shared report filters', async () => {
    const forbidden = await request(createServer(), { path: '/buyers/insights' });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      path: `/buyers/insights?shopId=${shopId}&salesChannelCode=amazon`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(service.getBuyerInsights).toHaveBeenCalledWith(
      expect.objectContaining({ shopId, salesChannelCode: 'AMAZON' }),
      auth,
    );
  });

  test('channel acquisition report uses shared report filters and permission', async () => {
    const forbidden = await request(createServer(), { path: '/ads/channel-performance' });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      path: `/ads/channel-performance?shopId=${shopId}&salesChannelCode=amazon`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(service.getAdsChannelPerformance).toHaveBeenCalledWith(
      expect.objectContaining({ shopId, salesChannelCode: 'AMAZON' }),
      auditedAuth(),
    );
  });

  test('ads seller attribution uses shared report filters and permission', async () => {
    const forbidden = await request(createServer(), { path: '/ads/by-seller' });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      path: `/ads/by-seller?shopId=${shopId}&salesChannelCode=amazon&marketplaceCode=amazon_us&dateFrom=2026-07-01&dateTo=2026-07-11`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(service.getAdsSellerAttribution).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId,
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        dateFrom: expect.any(Date),
        dateTo: expect.any(Date),
      }),
      auditedAuth(),
    );
  });

  test('ads daily requires REPORTS:READ and uses shared report filters', async () => {
    const forbidden = await request(createServer(), { path: '/ads/daily' });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      path: `/ads/daily?shopId=${shopId}&salesChannelCode=amazon&marketplaceCode=amazon_us&dateFrom=2026-07-01&dateTo=2026-07-11`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(service.getAdsDaily).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId,
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        dateFrom: expect.any(Date),
        dateTo: expect.any(Date),
      }),
      auditedAuth(),
    );
  });

  test('daily employee ads require report permission and filter by sales channel', async () => {
    const forbidden = await request(createServer(), { path: '/ads/seller-daily' });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      path: `/ads/seller-daily?shopId=${shopId}&salesChannelCode=amazon&dateFrom=2026-07-01&dateTo=2026-07-11`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });

    expect(allowed.statusCode).toBe(200);
    expect(service.getAdsSellerDaily).toHaveBeenCalledWith(
      expect.objectContaining({ shopId, salesChannelCode: 'AMAZON' }),
      auditedAuth(),
    );
  });
});
