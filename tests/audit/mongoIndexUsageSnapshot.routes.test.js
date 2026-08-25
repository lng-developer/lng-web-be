process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/lng_web_be_test';

const http = require('http');
const express = require('express');

jest.mock('../../src/modules/audit/services/auditEvent.service');
jest.mock('../../src/modules/audit/services/mongoIndexUsageSnapshot.service', () => ({ listRecent: jest.fn() }));
jest.mock('../../src/shared/utils/logger', () => ({ warn: jest.fn(), error: jest.fn() }));
jest.mock('../../src/modules/auth/public', () => {
  const AppError = require('../../src/shared/errors/appError');
  return {
    authenticate: (req, res, next) => {
      const context = req.headers['x-auth-context'];
      if (!context) return next(new AppError('Authentication required', 401, true, 'AUTHENTICATION_ERROR'));
      req.auth = JSON.parse(context);
      return next();
    },
    authorizePermissions: (...permissions) => (req, res, next) => {
      const granted = req.auth.permissions || [];
      if (permissions.every((permission) => granted.includes(permission))) return next();
      return next(new AppError('Forbidden', 403, true, 'AUTHORIZATION_ERROR'));
    },
    authorizeAnyPermission: () => (req, res, next) => next(),
  };
});

const router = require('../../src/modules/audit/routes');
const service = require('../../src/modules/audit/services/mongoIndexUsageSnapshot.service');
const errorHandler = require('../../src/middlewares/errorHandler');

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

test('GET /mongo-index-usage-snapshots exposes bounded history only to global audit readers', async () => {
  service.listRecent.mockResolvedValue([{ capturedOn: '2026-08-25', collections: [] }]);

  const anonymous = await request(createServer(), '/mongo-index-usage-snapshots');
  const scoped = await request(createServer(), '/mongo-index-usage-snapshots', {
    permissions: [], scopes: [{ permissions: ['AUDIT:READ'] }],
  });
  const allowed = await request(createServer(), '/mongo-index-usage-snapshots?limit=7', { permissions: ['AUDIT:READ'] });
  const invalid = await request(createServer(), '/mongo-index-usage-snapshots?limit=31', { permissions: ['AUDIT:READ'] });

  expect(anonymous.statusCode).toBe(401);
  expect(scoped.statusCode).toBe(403);
  expect(allowed).toMatchObject({ statusCode: 200, body: { success: true, data: [{ capturedOn: '2026-08-25', collections: [] }] } });
  expect(service.listRecent).toHaveBeenCalledWith({ limit: 7 });
  expect(invalid.statusCode).toBe(400);
});
