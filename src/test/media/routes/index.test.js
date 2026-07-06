const http = require('http');
const express = require('express');
const mediaRouter = require('../../../modules/media/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const mediaAssetService = require('../../../modules/media/services/mediaAsset.service');

jest.mock('../../../modules/media/services/mediaAsset.service');

jest.mock('../../../modules/auth/public', () => ({
  authenticate: (req, res, next) => {
    req.auth = { permissions: ['MEDIA:WRITE'], accountId: '660000000000000000000901', scopes: [] };
    next();
  },
  authorizeAnyPermission: () => (req, res, next) => next(),
}));

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(mediaRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, headers = {}, rawBody }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const { port } = server.address();
      const req = http.request({
        method,
        port,
        path,
        headers: rawBody ? {
          ...headers,
          'Content-Length': Buffer.byteLength(rawBody),
        } : headers,
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          server.close(() => resolve({
            statusCode: res.statusCode,
            body: responseBody ? JSON.parse(responseBody) : null,
          }));
        });
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

describe('media routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /assets accepts multipart file and returns media asset dto', async () => {
    mediaAssetService.storeAsset.mockResolvedValue({
      _id: '660000000000000000000902',
      originalFilename: 'scaled.png',
      mimeType: 'image/png',
      size: 9,
      sha256: 'a'.repeat(64),
      provider: 'local',
      resourceType: null,
      secureUrl: null,
      relativeStoragePath: 'private/path/should-not-leak.png',
      createdAt: new Date('2026-07-04T00:00:00.000Z'),
    });
    const boundary = '----mediauploadtest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="scaled.png"',
      'Content-Type: image/png',
      '',
      'image-data',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const response = await request(createServer(), {
      method: 'POST',
      path: '/assets',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody,
    });

    expect(response.statusCode).toBe(201);
    expect(mediaAssetService.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'scaled.png',
      mimeType: 'image/png',
      metadata: expect.objectContaining({
        source: 'MEDIA_UPLOAD',
        uploadedBy: '660000000000000000000901',
      }),
    }));
    expect(response.body).toEqual({
      success: true,
      data: expect.objectContaining({
        id: '660000000000000000000902',
        originalFilename: 'scaled.png',
        mimeType: 'image/png',
        size: 9,
        provider: 'local',
      }),
    });
    expect(JSON.stringify(response.body)).not.toContain('relativeStoragePath');
  });

  test('POST /assets rejects missing file', async () => {
    const response = await request(createServer(), {
      method: 'POST',
      path: '/assets',
      headers: { 'Content-Type': 'application/json' },
      rawBody: Buffer.from('{}'),
    });

    expect(response.statusCode).toBe(400);
    expect(mediaAssetService.storeAsset).not.toHaveBeenCalled();
  });
});
