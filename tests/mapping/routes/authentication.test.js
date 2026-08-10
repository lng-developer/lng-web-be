const http = require('http');
const express = require('express');
const mappingRouter = require('../../../src/modules/mapping/routes');
const errorHandler = require('../../../src/middlewares/errorHandler');

function createServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/mapping', mappingRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, path) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const req = http.request({
        method: 'POST',
        port: server.address().port,
        path,
      }, (res) => {
        res.resume();
        res.on('end', () => server.close(() => resolve(res.statusCode)));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      req.end();
    });
  });
}

describe('mapping rule evaluation authentication', () => {
  test.each(['/api/mapping/rule-preview', '/api/mapping/rule-conflicts'])(
    'POST %s returns 401 without a bearer token',
    async (path) => {
      await expect(request(createServer(), path)).resolves.toBe(401);
    },
  );
});
