const http = require('http');
const express = require('express');

jest.mock('../../modules/audit/services/auditEvent.service');
jest.mock('../../modules/auth/public', () => {
  const AppError = require('../../shared/errors/appError');
  const httpStatus = require('../../shared/constants/httpStatus');
  const errorCodes = require('../../shared/constants/errorCodes');
  return {
    authenticate: (req, res, next) => {
      const context = req.headers['x-auth-context'];
      if (!context) return next(new AppError('Authentication required', 401, true, 'AUTHENTICATION_ERROR'));
      req.auth = JSON.parse(context);
      return next();
    },
    authorizeAnyPermission: (...permissions) => (req, res, next) => {
      const granted = [...(req.auth.permissions || []), ...(req.auth.scopes || []).flatMap((scope) => scope.permissions || [])];
      if (permissions.some((permission) => granted.includes(permission))) return next();
      return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
    },
  };
});

const router = require('../../modules/audit/routes');
const service = require('../../modules/audit/services/auditEvent.service');
const errorHandler = require('../../middlewares/errorHandler');
const eventId = '660000000000000000000301';

function createServer() {
  const app = express(); app.use(router); app.use(errorHandler); return http.createServer(app);
}
function request(server, path, authContext) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const req = http.request({ port: server.address().port, path, headers: authContext ? { 'X-Auth-Context': JSON.stringify(authContext) } : {} }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => server.close(() => resolve({ statusCode: res.statusCode, body: body ? JSON.parse(body) : null })));
      });
      req.on('error', (error) => server.close(() => reject(error))); req.end();
    });
  });
}

describe('audit routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.listEvents.mockResolvedValue({ items: [], nextCursor: null });
    service.getEvent.mockResolvedValue({ id: eventId, action: 'ORDER_IMPORTED' });
  });

  test('GET /events requires authentication and accepts scoped AUDIT:READ', async () => {
    const anonymous = await request(createServer(), '/events');
    const forbidden = await request(createServer(), '/events', { permissions: [], scopes: [] });
    const scoped = { permissions: [], scopes: [{ scopeType: 'shop', scopeId: 'shop-1', permissions: ['AUDIT:READ'] }] };
    const allowed = await request(createServer(), '/events?limit=25&entityType=order', scoped);
    expect(anonymous.statusCode).toBe(401); expect(forbidden.statusCode).toBe(403); expect(allowed.statusCode).toBe(200);
    expect(allowed.body.data).toEqual({ items: [], nextCursor: null });
    expect(service.listEvents).toHaveBeenCalledWith({ limit: 25, entityType: 'ORDER' }, scoped);
  });

  test('GET /events validates bounded filters, dates, cursor, and limit', async () => {
    const auth = { permissions: ['AUDIT:READ'] };
    const paths = [
      '/events?limit=101',
      '/events?dateFrom=2026-07-02T00:00:00.000Z&dateTo=2026-07-01T00:00:00.000Z',
      '/events?dateFrom=2025-01-01T00:00:00.000Z&dateTo=2026-07-01T00:00:00.000Z',
      '/events?cursor=not-a-cursor', '/events?scopeId=shop-1',
    ];
    for (const path of paths) expect((await request(createServer(), path, auth)).statusCode).toBe(400);
    expect(service.listEvents).not.toHaveBeenCalled();
  });

  test('GET /events forwards every supported validated filter', async () => {
    const actorAccountId = '660000000000000000000302'; const auth = { permissions: ['AUDIT:READ'] };
    const response = await request(createServer(), `/events?actorAccountId=${actorAccountId}&action=order_imported&entityType=order&entityId=order-1&scopeType=shop&scopeId=shop-1&outcome=succeeded&source=import&requestId=req-1&dateFrom=2026-07-01T00:00:00.000Z&dateTo=2026-07-02T00:00:00.000Z&limit=10`, auth);
    expect(response.statusCode).toBe(200);
    expect(service.listEvents).toHaveBeenCalledWith({
      actorAccountId, action: 'ORDER_IMPORTED', entityType: 'ORDER', entityId: 'order-1',
      scopeType: 'SHOP', scopeId: 'shop-1', outcome: 'SUCCEEDED', source: 'IMPORT', requestId: 'req-1',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'), dateTo: new Date('2026-07-02T00:00:00.000Z'), limit: 10,
    }, auth);
  });

  test('GET /events/:eventId validates the id and returns service DTO data', async () => {
    const auth = { permissions: ['AUDIT:READ'] };
    const invalid = await request(createServer(), '/events/not-an-id', auth);
    const allowed = await request(createServer(), `/events/${eventId}`, auth);
    expect(invalid.statusCode).toBe(400); expect(allowed.statusCode).toBe(200);
    expect(allowed.body.data).toEqual({ id: eventId, action: 'ORDER_IMPORTED' });
    expect(service.getEvent).toHaveBeenCalledWith(eventId, auth);
  });
});
