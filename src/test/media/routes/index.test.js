const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const mediaRouter = require('../../../modules/media/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const mediaAssetService = require('../../../modules/media/services/mediaAsset.service');
const multipartUploadService = require('../../../modules/media/services/multipartUpload.service');

jest.mock('../../../modules/media/services/mediaAsset.service');
jest.mock('../../../modules/media/services/multipartUpload.service');

let mockPermissions = ['MEDIA:WRITE'];

jest.mock('../../../modules/auth/public', () => ({
  authenticate: (req, res, next) => {
    req.auth = { permissions: mockPermissions, accountId: '660000000000000000000901', scopes: [] };
    next();
  },
  authorizeAnyPermission: (...permissions) => (req, res, next) => {
    if (permissions.some((permission) => (req.auth.permissions || []).includes(permission))) {
      next();
      return;
    }
    res.status(403).json({ success: false, code: 'AUTHORIZATION_ERROR' });
  },
  authorizePermissions: (...permissions) => (req, res, next) => {
    if (permissions.every((permission) => (req.auth.permissions || []).includes(permission))) {
      next();
      return;
    }
    res.status(403).json({ success: false, code: 'AUTHORIZATION_ERROR' });
  },
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
          const isJson = String(res.headers['content-type'] || '').includes('application/json');
          server.close(() => resolve({
            statusCode: res.statusCode,
            body: responseBody && isJson ? JSON.parse(responseBody) : responseBody || null,
            headers: res.headers,
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
    mockPermissions = ['MEDIA:WRITE'];
    mediaAssetService.getAuthorizedDownloadUrl.mockResolvedValue(null);
  });

  test('POST /assets accepts PSD multipart file, streams it, and removes temp file', async () => {
    let tempPath;
    mediaAssetService.storeAsset.mockResolvedValue({
      _id: '660000000000000000000902',
      originalFilename: 'template.psd',
      mimeType: 'application/octet-stream',
      size: 9,
      sha256: 'a'.repeat(64),
      provider: 'local',
      resourceType: null,
      secureUrl: 'https://res.cloudinary.com/demo/raw/upload/template.psd',
      relativeStoragePath: 'private/path/should-not-leak.png',
      createdAt: new Date('2026-07-04T00:00:00.000Z'),
    });
    mediaAssetService.storeAsset.mockImplementation(async (payload) => {
      tempPath = payload.stream.path;
      await new Promise((resolve, reject) => {
        payload.stream.on('error', reject);
        payload.stream.on('close', resolve);
        payload.stream.resume();
      });
      return {
        _id: '660000000000000000000902',
        originalFilename: 'template.psd',
        mimeType: 'application/octet-stream',
        size: 9,
        sha256: 'a'.repeat(64),
        provider: 'local',
        resourceType: null,
        secureUrl: null,
        relativeStoragePath: 'private/path/should-not-leak.png',
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
      };
    });
    const boundary = '----mediauploadtest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="template.psd"',
      'Content-Type: application/octet-stream',
      '',
      'psd-data',
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
    expect(response.headers.location).toBe('/api/media/assets/660000000000000000000902');
    expect(mediaAssetService.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'template.psd',
      mimeType: 'application/octet-stream',
      metadata: expect.objectContaining({
        source: 'MEDIA_UPLOAD',
        uploadedBy: '660000000000000000000901',
      }),
    }));
    expect(response.body).toEqual({
      success: true,
      data: expect.objectContaining({
        id: '660000000000000000000902',
        originalFilename: 'template.psd',
        mimeType: 'application/octet-stream',
        size: 9,
        provider: 'local',
      }),
    });
    expect(response.body.data.downloadUrl).toBe('/api/media/assets/660000000000000000000902/download');
    expect(response.body.data).not.toHaveProperty('secureUrl');
    expect(tempPath).toBeTruthy();
    expect(fs.existsSync(tempPath)).toBe(false);
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

  test('POST /multipart/initiate returns a safe upload contract', async () => {
    multipartUploadService.initiateUpload.mockResolvedValue({
      assetId: '660000000000000000000902', partSize: 67108864, totalParts: 2,
    });
    const rawBody = JSON.stringify({
      filename: 'package.zip', mimeType: 'application/zip', size: 104857600,
      assetPurpose: 'DESIGN_PACKAGE',
    });

    const response = await request(createServer(), {
      method: 'POST', path: '/multipart/initiate',
      headers: { 'Content-Type': 'application/json' }, rawBody,
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.data).toEqual({
      assetId: '660000000000000000000902', partSize: 67108864, totalParts: 2,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/multipartUploadId|providerAssetId|secret/i);
  });

  test('POST /multipart/:assetId/presign-parts validates and returns part URLs', async () => {
    multipartUploadService.presignParts.mockResolvedValue([{ partNumber: 1, url: 'https://upload.example' }]);
    const rawBody = JSON.stringify({ partNumbers: [1] });

    const response = await request(createServer(), {
      method: 'POST', path: '/multipart/660000000000000000000902/presign-parts',
      headers: { 'Content-Type': 'application/json' }, rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.parts).toEqual([{ partNumber: 1, url: 'https://upload.example' }]);
  });

  test('POST /multipart/:assetId/complete completes the upload', async () => {
    multipartUploadService.completeUpload.mockResolvedValue({
      _id: '660000000000000000000902', originalFilename: 'package.zip', size: 100,
      provider: 'wasabi', assetPurpose: 'DESIGN_PACKAGE', uploadStatus: 'READY',
    });
    const response = await request(createServer(), {
      method: 'POST', path: '/multipart/660000000000000000000902/complete',
      headers: { 'Content-Type': 'application/json' },
      rawBody: JSON.stringify({ parts: [{ partNumber: 1, etag: 'etag-1' }] }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.data.uploadStatus).toBe('READY');
  });

  test('DELETE /multipart/:assetId aborts the upload', async () => {
    multipartUploadService.abortUpload.mockResolvedValue({
      _id: '660000000000000000000902', originalFilename: 'package.zip', size: 100,
      provider: 'wasabi', assetPurpose: 'DESIGN_PACKAGE', uploadStatus: 'ABORTED',
    });
    const response = await request(createServer(), {
      method: 'DELETE', path: '/multipart/660000000000000000000902',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.data.uploadStatus).toBe('ABORTED');
  });

  test('POST /assets rejects files over 10 MiB before storage work', async () => {
    const boundary = '----mediaoversizeduploadtest';
    const rawBody = Buffer.concat([
      Buffer.from([
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="large.psd"',
        'Content-Type: application/octet-stream',
        '',
        '',
      ].join('\r\n')),
      Buffer.alloc((10 * 1024 * 1024) + 1, 1),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await request(createServer(), {
      method: 'POST',
      path: '/assets',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody,
    });
    expect(response.statusCode).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(mediaAssetService.storeAsset).not.toHaveBeenCalled();
  });

  test('POST /assets rejects unsupported upload MIME and extension', async () => {
    const boundary = '----mediauploadtest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="notes.txt"',
      'Content-Type: text/plain',
      '',
      'hello',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const response = await request(createServer(), {
      method: 'POST',
      path: '/assets',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody,
    });

    expect(response.statusCode).toBe(400);
    expect(mediaAssetService.storeAsset).not.toHaveBeenCalled();
  });

  test('GET /assets/:assetId requires MEDIA:READ', async () => {
    const response = await request(createServer(), {
      method: 'GET',
      path: '/assets/660000000000000000000902',
    });

    expect(response.statusCode).toBe(403);
    expect(mediaAssetService.getAuthorizedAsset).not.toHaveBeenCalled();
  });

  test('GET /assets lists safe metadata with global MEDIA:READ', async () => {
    mockPermissions = ['MEDIA:READ'];
    mediaAssetService.listAssets.mockResolvedValue({
      items: [{
        _id: '660000000000000000000902',
        originalFilename: 'scaled.png',
        mimeType: 'image/png',
        size: 9,
        sha256: 'a'.repeat(64),
        provider: 'local',
        ownerType: 'ORDER_ITEM',
        relativeStoragePath: 'private/path.png',
        discardedAt: null,
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
      }],
      pagination: { total: 1, page: 1, limit: 20 },
    });

    const response = await request(createServer(), { method: 'GET', path: '/assets?q=' });

    expect(response.statusCode).toBe(200);
    expect(mediaAssetService.listAssets).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
    expect(response.body.data.items[0]).toEqual(expect.objectContaining({
      originalFilename: 'scaled.png',
      ownerType: 'ORDER_ITEM',
      status: 'ACTIVE',
    }));
    expect(JSON.stringify(response.body)).not.toMatch(/sha256|relativeStoragePath|ownerId|shopId|secureUrl/);
  });

  test('GET /assets validates filters', async () => {
    mockPermissions = ['MEDIA:READ'];
    const response = await request(createServer(), { method: 'GET', path: '/assets?status=UNKNOWN' });
    expect(response.statusCode).toBe(400);
    expect(mediaAssetService.listAssets).not.toHaveBeenCalled();
  });

  test('GET /assets/:assetId returns media asset metadata without storage path', async () => {
    mockPermissions = ['MEDIA:READ'];
    mediaAssetService.getAuthorizedAsset.mockResolvedValue({
      _id: '660000000000000000000902',
      originalFilename: 'scaled.png',
      mimeType: 'image/png',
      size: 9,
      sha256: 'a'.repeat(64),
      provider: 'local',
      resourceType: null,
      secureUrl: 'https://res.cloudinary.com/demo/image/upload/scaled.png',
      relativeStoragePath: 'private/path/should-not-leak.png',
      createdAt: new Date('2026-07-04T00:00:00.000Z'),
    });

    const response = await request(createServer(), {
      method: 'GET',
      path: '/assets/660000000000000000000902',
    });

    expect(response.statusCode).toBe(200);
    expect(mediaAssetService.getAuthorizedAsset).toHaveBeenCalledWith(
      '660000000000000000000902',
      expect.objectContaining({ accountId: '660000000000000000000901' }),
    );
    expect(response.body.data).toEqual(expect.objectContaining({
      id: '660000000000000000000902',
      originalFilename: 'scaled.png',
      provider: 'local',
    }));
    expect(response.body.data.downloadUrl).toBe('/api/media/assets/660000000000000000000902/download');
    expect(response.body.data).not.toHaveProperty('secureUrl');
    expect(JSON.stringify(response.body)).not.toContain('relativeStoragePath');
  });

  test('GET /assets/:assetId returns 404 without exposing filesystem path when missing', async () => {
    mockPermissions = ['MEDIA:READ'];
    mediaAssetService.getAuthorizedAsset.mockRejectedValue(new AppError(
      'Media asset not found',
      httpStatus.NOT_FOUND,
      true,
      errorCodes.RESOURCE_NOT_FOUND,
    ));

    const response = await request(createServer(), {
      method: 'GET',
      path: '/assets/660000000000000000000902',
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.stringify(response.body)).not.toMatch(/relativeStoragePath|private\/path|storageFilename/i);
  });

  test('GET /assets/:assetId/download streams asset bytes without exposing storage path', async () => {
    mockPermissions = ['MEDIA:READ'];
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-download-test-'));
    const localPath = path.join(tempDir, 'scaled.png');
    await fs.promises.writeFile(localPath, 'image-data');
    mediaAssetService.withAuthorizedAssetLocalReadFile.mockImplementation(async (_assetId, _auth, callback) => callback({
      mediaAsset: {
        _id: '660000000000000000000902',
        originalFilename: 'scaled.png',
        mimeType: 'image/png',
      },
      localPath,
    }));

    try {
      const response = await request(createServer(), {
        method: 'GET',
        path: '/assets/660000000000000000000902/download',
      });

      expect(response.statusCode).toBe(200);
      expect(mediaAssetService.withAuthorizedAssetLocalReadFile).toHaveBeenCalledWith(
        '660000000000000000000902',
        expect.objectContaining({ accountId: '660000000000000000000901' }),
        expect.any(Function),
      );
      expect(mediaAssetService.readAssetBuffer).not.toHaveBeenCalled();
      expect(response.body).toBe('image-data');
      expect(JSON.stringify(response.headers)).not.toContain('relativeStoragePath');
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('GET /assets/:assetId/download redirects ready Wasabi assets without proxying bytes', async () => {
    mockPermissions = ['MEDIA:READ'];
    mediaAssetService.getAuthorizedDownloadUrl.mockResolvedValue('https://wasabi.example/signed');

    const response = await request(createServer(), {
      method: 'GET', path: '/assets/660000000000000000000902/download',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://wasabi.example/signed');
    expect(mediaAssetService.withAuthorizedAssetLocalReadFile).not.toHaveBeenCalled();
  });

  test('GET /assets/:assetId/download returns 404 when asset file is missing', async () => {
    mockPermissions = ['MEDIA:READ'];
    mediaAssetService.withAuthorizedAssetLocalReadFile.mockRejectedValue(
      Object.assign(new Error('Media asset file not found'), { code: 'MEDIA_ASSET_FILE_NOT_FOUND' }),
    );

    const response = await request(createServer(), {
      method: 'GET',
      path: '/assets/660000000000000000000902/download',
    });

    expect(response.statusCode).toBe(404);
    expect(response.body.error.message).toBe('Media asset file not found');
  });
});
