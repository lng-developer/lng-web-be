const http = require('http');

function request(server, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port: server.address().port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

function createServer(metricsEnabled) {
  jest.resetModules();
  process.env.METRICS_ENABLED = String(metricsEnabled);
  process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/lng_web_be_test';
  const createApp = require('../../app');
  return createApp().listen(0);
}

describe('HTTP metrics', () => {
  afterEach(() => {
    delete process.env.METRICS_ENABLED;
  });

  test('does not expose the endpoint when metrics are disabled', async () => {
    const server = createServer(false);

    try {
      expect((await request(server, '/internal/metrics')).statusCode).toBe(404);
    } finally {
      server.close();
    }
  });

  test('exports bounded route labels without IDs or query strings', async () => {
    const server = createServer(true);
    const concreteId = '507f1f77bcf86cd799439011';

    try {
      await request(server, `/api/shops/${concreteId}?token=private`);
      const response = await request(server, '/internal/metrics');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
      expect(response.body).toContain('lng_http_requests_total');
      expect(response.body).toContain('route="/api/shops/:shopId"');
      expect(response.body).not.toContain(concreteId);
      expect(response.body).not.toContain('token=private');
    } finally {
      server.close();
    }
  });
});
