const http = require('http');
const express = require('express');
const errorHandler = require('../../../../middlewares/errorHandler');
const service = require('../../../../modules/integration/externalOrderImport/services/externalOrderImport.service');

jest.mock('../../../../modules/integration/externalOrderImport/services/externalOrderImport.service', () => ({
  getImportJob: jest.fn(),
}));

jest.mock('../../../../modules/auth/public', () => {
  const actual = jest.requireActual('../../../../modules/auth/public');

  return {
    ...actual,
    authenticate: (req, res, next) => {
      req.auth = JSON.parse(req.headers['x-auth-context']);
      next();
    },
  };
});

const router = require('../../../../modules/integration/externalOrderImport/routes/externalOrderImport.routes');

function createServer() {
  const app = express();
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, auth }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: { 'X-Auth-Context': JSON.stringify(auth) },
      }, (res) => {
        res.resume();
        res.on('end', () => server.close(() => resolve(res.statusCode)));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      req.end();
    });
  });
}

describe('externalOrderImport routes', () => {
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
