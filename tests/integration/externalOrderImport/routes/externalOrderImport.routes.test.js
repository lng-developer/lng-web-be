const http = require('http');
const express = require('express');
const errorHandler = require('../../../../src/middlewares/errorHandler');
const service = require('../../../../src/modules/integration/externalOrderImport/services/externalOrderImport.service');

jest.mock('../../../../src/modules/integration/externalOrderImport/services/externalOrderImport.service', () => ({
  getImportJob: jest.fn(),
  listImportJobs: jest.fn(),
  updateIssueStatus: jest.fn(),
}));

jest.mock('../../../../src/modules/auth/public', () => {
  const actual = jest.requireActual('../../../../src/modules/auth/public');

  return {
    ...actual,
    authenticate: (req, res, next) => {
      if (!req.headers['x-auth-context']) {
        res.status(401).end();
        return;
      }
      req.auth = JSON.parse(req.headers['x-auth-context']);
      next();
    },
  };
});

const router = require('../../../../src/modules/integration/externalOrderImport/routes/externalOrderImport.routes');

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, auth, body, contentType }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: {
          ...(auth ? { 'X-Auth-Context': JSON.stringify(auth) } : {}),
          ...(body ? { 'Content-Type': contentType || 'application/json' } : {}),
        },
      }, (res) => {
        res.resume();
        res.on('end', () => server.close(() => resolve(res.statusCode)));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      req.end(Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined);
    });
  });
}

describe('externalOrderImport routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.listImportJobs.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    service.updateIssueStatus.mockResolvedValue({
      _id: '660000000000000000000901',
      status: 'RESOLVED',
      resolutionNote: 'Corrected source row',
    });
  });

  test('allows scoped ORDERS:WRITE to list import jobs', async () => {
    const auth = {
      scopes: [{
        scopeType: 'shop',
        scopeId: '660000000000000000000201',
        permissions: ['ORDERS:WRITE'],
      }],
    };

    const statusCode = await request(createServer(), {
      method: 'GET',
      path: '/?status=FAILED',
      auth,
    });

    expect(statusCode).toBe(200);
    expect(service.listImportJobs).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }), auth);
    expect(service.getImportJob).not.toHaveBeenCalled();
  });

  test('rejects invalid list filters before calling the service', async () => {
    const statusCode = await request(createServer(), {
      method: 'GET',
      path: '/?limit=101',
      auth: { permissions: ['ORDERS:READ'] },
    });

    expect(statusCode).toBe(400);
    expect(service.listImportJobs).not.toHaveBeenCalled();
  });

  test('requires ORDERS:WRITE to resolve an issue', async () => {
    const statusCode = await request(createServer(), {
      method: 'PATCH',
      path: '/issues/660000000000000000000901',
      auth: { permissions: ['ORDERS:READ'] },
      body: { status: 'RESOLVED', note: 'Corrected source row' },
    });

    expect(statusCode).toBe(403);
    expect(service.updateIssueStatus).not.toHaveBeenCalled();
  });

  test('rejects an unauthenticated oversized raw upload before buffering it', async () => {
    const statusCode = await request(createServer(), {
      method: 'POST',
      path: '/manual-excel',
      body: Buffer.alloc(10 * 1024 * 1024 + 1),
      contentType: 'text/csv',
    });

    expect(statusCode).toBe(401);
  });

  test('rejects a read-only oversized raw upload before buffering it', async () => {
    const statusCode = await request(createServer(), {
      method: 'POST',
      path: '/manual-excel',
      auth: { permissions: ['ORDERS:READ'] },
      body: Buffer.alloc(10 * 1024 * 1024 + 1),
      contentType: 'text/csv',
    });

    expect(statusCode).toBe(403);
  });

  test('allows ORDERS:WRITE to resolve an issue', async () => {
    const auth = { accountId: '660000000000000000000801', permissions: ['ORDERS:WRITE'] };
    const statusCode = await request(createServer(), {
      method: 'PATCH',
      path: '/issues/660000000000000000000901',
      auth,
      body: { status: 'RESOLVED', note: 'Corrected source row' },
    });

    expect(statusCode).toBe(200);
    expect(service.updateIssueStatus).toHaveBeenCalledWith(
      '660000000000000000000901',
      { status: 'RESOLVED', note: 'Corrected source row' },
      auth,
    );
  });

  test('allows scoped ORDERS:WRITE to reach an import-job read operation', async () => {
    const auth = {
      scopes: [{
        scopeType: 'shop',
        scopeId: '660000000000000000000201',
        permissions: ['ORDERS:WRITE'],
      }],
    };
    service.getImportJob.mockResolvedValue({
      _id: '660000000000000000000601',
      shopId: '660000000000000000000201',
      status: 'COMPLETED',
      summary: {},
    });

    const statusCode = await request(createServer(), {
      method: 'GET',
      path: '/660000000000000000000601',
      auth,
    });

    expect(statusCode).toBe(200);
    expect(service.getImportJob).toHaveBeenCalledWith('660000000000000000000601', auth);
  });
});
