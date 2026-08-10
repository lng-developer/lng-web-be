jest.mock('../../../src/modules/media/repositories/mediaAsset.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findByIds: jest.fn(),
  findIdsByOriginalFilename: jest.fn(),
  list: jest.fn(),
  markDiscardedIfMetadataMatches: jest.fn(),
}));

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      destroy: jest.fn(),
      upload_stream: jest.fn(),
    },
  },
}));

jest.mock('https', () => ({
  get: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

const EventEmitter = require('events');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { PassThrough, Readable, Writable } = require('stream');
const cloudinary = require('cloudinary').v2;
const authPublic = require('../../../src/modules/auth/public');
const repository = require('../../../src/modules/media/repositories/mediaAsset.repository');
const service = require('../../../src/modules/media/services/mediaAsset.service');
const {
  createIdleTimeoutTransform,
  createPeekClassificationTransform,
} = require('../../../src/shared/network/safeRemoteFetchStream');

describe('mediaAsset.service', () => {
  let root;
  let previousRoot;

  beforeEach(async () => {
    jest.clearAllMocks();
    previousRoot = process.env.MEDIA_STORAGE_ROOT;
    delete process.env.MEDIA_STORAGE_PROVIDER;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-store-'));
    process.env.MEDIA_STORAGE_ROOT = root;
    repository.create.mockImplementation(async (payload) => ({ _id: '660000000000000000000901', ...payload }));
  });

  afterEach(async () => {
    if (previousRoot === undefined) {
      delete process.env.MEDIA_STORAGE_ROOT;
    } else {
      process.env.MEDIA_STORAGE_ROOT = previousRoot;
    }

    await fs.promises.rm(root, { recursive: true, force: true });
  });

  test('storeAsset writes stream, computes metadata, and stores redacted URL only', async () => {
    const result = await service.storeAsset({
      stream: Readable.from([Buffer.from('hello '), Buffer.from('world')]),
      filename: '../custom file.zip',
      mimeType: 'application/zip',
      sourceUrlRedacted: 'https://zme-caps.amazon.com/t/file.zip?[REDACTED]',
      sourceUrlHash: 'url-hash',
      metadata: { classification: 'zip' },
      shopId: '660000000000000000000111',
      ownerType: 'PRODUCTION_TASK',
      ownerId: '660000000000000000000222',
      maxBytes: 1024,
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      originalFilename: 'custom file.zip',
      mimeType: 'application/zip',
      size: 11,
      sourceUrlRedacted: 'https://zme-caps.amazon.com/t/file.zip?[REDACTED]',
      sourceUrlHash: 'url-hash',
      metadata: { classification: 'zip' },
      shopId: '660000000000000000000111',
      ownerType: 'PRODUCTION_TASK',
      ownerId: '660000000000000000000222',
    }));
    expect(repository.create.mock.calls[0][0].sha256).toHaveLength(64);
    expect(repository.create.mock.calls[0][0].relativeStoragePath).not.toContain('..');
    await expect(fs.promises.stat(path.join(root, result.relativeStoragePath))).resolves.toMatchObject({ size: 11 });
  });

  test('storeAsset preserves ZIP magic bytes after peek classification transform', async () => {
    const source = Readable.from([
      Buffer.from([0x50, 0x4B]),
      Buffer.from([0x03, 0x04, 0x41, 0x42]),
    ]).pipe(createPeekClassificationTransform({
      statusCode: 200,
      contentType: 'application/zip',
    }));

    const result = await service.storeAsset({
      stream: source,
      filename: 'custom.zip',
      mimeType: 'application/zip',
      sourceUrlRedacted: 'https://example.test/custom.zip',
      sourceUrlHash: 'hash',
      maxBytes: 1024,
    });

    const saved = await fs.promises.readFile(path.join(root, result.relativeStoragePath));
    expect(saved.subarray(0, 2)).toEqual(Buffer.from([0x50, 0x4B]));
  });

  test('storeAsset deletes temp file when stream exceeds maxBytes', async () => {
    await expect(service.storeAsset({
      stream: Readable.from([Buffer.alloc(5), Buffer.alloc(5)]),
      filename: 'too-big.zip',
      mimeType: 'application/zip',
      sourceUrlRedacted: 'https://example.test/too-big.zip',
      sourceUrlHash: 'hash',
      maxBytes: 8,
    })).rejects.toMatchObject({ code: 'MEDIA_ASSET_TOO_LARGE' });

    const files = await fs.promises.readdir(root, { recursive: true });
    expect(files.filter((file) => String(file).endsWith('.part'))).toHaveLength(0);
    expect(repository.create).not.toHaveBeenCalled();
  });

  test('storeAsset deletes partial file when stream idle timeout fails pipeline', async () => {
    jest.useFakeTimers();
    const source = new PassThrough();
    const promise = service.storeAsset({
      stream: source.pipe(createIdleTimeoutTransform(25)),
      filename: 'idle.zip',
      mimeType: 'application/zip',
      sourceUrlRedacted: 'https://example.test/idle.zip',
      sourceUrlHash: 'hash',
      maxBytes: 1024,
    });

    source.write(Buffer.from([0x50, 0x4B, 0x03, 0x04]));
    await Promise.resolve();
    jest.advanceTimersByTime(26);

    await expect(promise).rejects.toMatchObject({ code: 'REMOTE_STREAM_IDLE_TIMEOUT' });
    const files = await fs.promises.readdir(root, { recursive: true });
    expect(files.filter((file) => String(file).endsWith('.part'))).toHaveLength(0);
    expect(files.filter((file) => !String(file).startsWith('tmp'))).toHaveLength(0);
    expect(repository.create).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('storeAsset deletes final file when database insert fails after rename', async () => {
    const dbError = new Error('db insert failed');
    repository.create.mockRejectedValueOnce(dbError);

    await expect(service.storeAsset({
      stream: Readable.from([Buffer.from('complete file')]),
      filename: 'complete.zip',
      mimeType: 'application/zip',
      sourceUrlRedacted: 'https://example.test/complete.zip',
      sourceUrlHash: 'hash',
      maxBytes: 1024,
    })).rejects.toBe(dbError);

    const files = await fs.promises.readdir(root, { recursive: true });
    expect(files.filter((file) => !String(file).startsWith('tmp'))).toHaveLength(0);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  test('storeAsset uploads stream to Cloudinary when configured', async () => {
    process.env.MEDIA_STORAGE_PROVIDER = 'cloudinary';
    process.env.CLOUDINARY_CLOUD_NAME = 'cloud-name';
    process.env.CLOUDINARY_API_KEY = 'api-key';
    process.env.CLOUDINARY_API_SECRET = 'api-secret';
    cloudinary.uploader.upload_stream.mockImplementation((options, callback) => {
      const chunks = [];
      return new Writable({
        write(chunk, encoding, done) {
          chunks.push(chunk);
          done();
        },
        final(done) {
          callback(null, {
            public_id: 'lng/custom/file',
            resource_type: 'image',
            secure_url: 'https://res.cloudinary.com/cloud-name/image/upload/lng/custom/file.png',
            bytes: Buffer.concat(chunks).length,
            format: 'png',
          });
          done();
        },
      });
    });

    const result = await service.storeAsset({
      stream: Readable.from([Buffer.from('cloud image')]),
      filename: 'image.png',
      mimeType: 'image/png',
      sourceUrlRedacted: 'https://example.test/image.png',
      sourceUrlHash: 'hash',
      metadata: { extractedFromZip: true },
      shopId: '660000000000000000000111',
      ownerType: 'CUSTOMIZATION_PAYLOAD',
      ownerId: '660000000000000000000333',
      maxBytes: 1024,
    });

    expect(cloudinary.config).toHaveBeenCalledWith({
      cloud_name: 'cloud-name',
      api_key: 'api-key',
      api_secret: 'api-secret',
    });
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'image',
      folder: 'lng-system/media',
      public_id: expect.stringMatching(/^image-/),
    }), expect.any(Function));
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      originalFilename: 'image.png',
      storageFilename: 'lng/custom/file',
      relativeStoragePath: 'https://res.cloudinary.com/cloud-name/image/upload/lng/custom/file.png',
      provider: 'cloudinary',
      providerAssetId: 'lng/custom/file',
      resourceType: 'image',
      secureUrl: 'https://res.cloudinary.com/cloud-name/image/upload/lng/custom/file.png',
      mimeType: 'image/png',
      size: 11,
      sha256: expect.any(String),
      metadata: { extractedFromZip: true },
      shopId: '660000000000000000000111',
      ownerType: 'CUSTOMIZATION_PAYLOAD',
      ownerId: '660000000000000000000333',
    }));
    expect(result.provider).toBe('cloudinary');
    const files = await fs.promises.readdir(root, { recursive: true });
    expect(files.filter((file) => !String(file).startsWith('tmp'))).toHaveLength(0);
  });

  test('discardUnattachedAsset rejects mismatched upload metadata without deleting storage', async () => {
    repository.markDiscardedIfMetadataMatches.mockResolvedValue(null);

    await expect(service.discardUnattachedAsset(
      '660000000000000000000901',
      { source: 'PRODUCTION_SCALED_OUTPUT', taskId: 'task-1', fileCheckId: 'check-1', uploadedBy: 'user-1' },
      'QC_PASS_CAS_LOST',
    )).rejects.toMatchObject({ code: 'MEDIA_ASSET_DISCARD_NOT_ALLOWED' });

    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
  });

  test('discardUnattachedAsset keeps a tombstone and deletes local storage', async () => {
    const localPath = path.join(root, 'orphan.png');
    await fs.promises.writeFile(localPath, 'orphan');
    repository.markDiscardedIfMetadataMatches.mockResolvedValue({
      _id: '660000000000000000000901',
      provider: 'local',
      relativeStoragePath: 'orphan.png',
    });

    await service.discardUnattachedAsset(
      '660000000000000000000901',
      { source: 'PRODUCTION_SCALED_OUTPUT', taskId: 'task-1', fileCheckId: 'check-1', uploadedBy: 'user-1' },
      'QC_PASS_CAS_LOST',
    );

    expect(repository.markDiscardedIfMetadataMatches).toHaveBeenCalledWith(
      '660000000000000000000901',
      { source: 'PRODUCTION_SCALED_OUTPUT', taskId: 'task-1', fileCheckId: 'check-1', uploadedBy: 'user-1' },
      'QC_PASS_CAS_LOST',
    );
    expect(fs.existsSync(localPath)).toBe(false);
  });

  test('discardUnattachedAsset deletes Cloudinary storage using recorded identifiers', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'cloud-name';
    process.env.CLOUDINARY_API_KEY = 'api-key';
    process.env.CLOUDINARY_API_SECRET = 'api-secret';
    repository.markDiscardedIfMetadataMatches.mockResolvedValue({
      _id: '660000000000000000000901',
      provider: 'cloudinary',
      providerAssetId: 'lng-system/media/orphan',
      resourceType: 'image',
    });
    cloudinary.uploader.destroy.mockResolvedValue({ result: 'ok' });

    await service.discardUnattachedAsset(
      '660000000000000000000901',
      { source: 'PRODUCTION_SCALED_OUTPUT', taskId: 'task-1', fileCheckId: 'check-1', uploadedBy: 'user-1' },
      'QC_PASS_CAS_LOST',
    );

    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
      'lng-system/media/orphan',
      { resource_type: 'image' },
    );
  });

  test('withAssetLocalReadFile passes safe local file only inside callback', async () => {
    const filePath = path.join(root, 'asset.zip');
    await fs.promises.writeFile(filePath, Buffer.from('zip'));
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000901',
      relativeStoragePath: 'asset.zip',
      mimeType: 'application/zip',
      size: 3,
      sha256: 'a'.repeat(64),
    });
    const callback = jest.fn(async ({ mediaAsset, localPath }) => {
      expect(localPath).toBe(filePath);
      expect(mediaAsset.size).toBe(3);
      return { inspected: true };
    });

    const result = await service.withAssetLocalReadFile('660000000000000000000901', callback);

    expect(repository.findById).toHaveBeenCalledWith('660000000000000000000901');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ inspected: true });
  });

  test('getAuthorizedAsset permits matching shop scope and global media reads', async () => {
    const scopedAsset = { _id: '660000000000000000000901', shopId: '660000000000000000000111' };
    repository.findById.mockResolvedValueOnce(scopedAsset);
    authPublic.canAccessScope.mockReturnValueOnce(true);

    await expect(service.getAuthorizedAsset('660000000000000000000901', { accountId: 'reader' }))
      .resolves.toBe(scopedAsset);
    expect(authPublic.canAccessScope).toHaveBeenCalledWith(
      { accountId: 'reader' },
      'MEDIA:READ',
      { scopeType: 'SHOP', scopeId: scopedAsset.shopId },
    );

    const legacyAsset = { _id: '660000000000000000000902', shopId: null };
    repository.findById.mockResolvedValueOnce(legacyAsset);
    authPublic.canAccessScope.mockReturnValueOnce(true);
    await expect(service.getAuthorizedAsset('660000000000000000000902', { accountId: 'reader' }))
      .resolves.toBe(legacyAsset);
    expect(authPublic.canAccessScope).toHaveBeenLastCalledWith(
      { accountId: 'reader' },
      'MEDIA:READ',
      { scopeType: null, scopeId: null },
    );
  });

  test('getPublicAssetUrl returns only vendor-visible provider URLs', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: '660000000000000000000903',
      provider: 'cloudinary',
      secureUrl: 'https://res.cloudinary.com/demo/image/upload/front.png',
      uploadStatus: 'READY',
    });

    await expect(service.getPublicAssetUrl('660000000000000000000903'))
      .resolves.toBe('https://res.cloudinary.com/demo/image/upload/front.png');

    repository.findById.mockResolvedValueOnce({
      _id: '660000000000000000000904',
      provider: 'local',
      uploadStatus: 'READY',
    });

    await expect(service.getPublicAssetUrl('660000000000000000000904')).resolves.toBeNull();
  });

  test('getAuthorizedAsset rejects cross-shop reads', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: '660000000000000000000901',
      shopId: '660000000000000000000111',
    });
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.getAuthorizedAsset('660000000000000000000901', { accountId: 'reader' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });

  test('withAssetLocalReadFile rejects paths outside storage root', async () => {
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000901',
      relativeStoragePath: '..\\outside.zip',
      size: 3,
    });

    await expect(service.withAssetLocalReadFile('660000000000000000000901', jest.fn()))
      .rejects.toMatchObject({ code: 'MEDIA_STORAGE_PATH_INVALID' });
  });

  test('withAssetLocalReadFile rejects missing files', async () => {
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000901',
      relativeStoragePath: 'missing.zip',
      size: 3,
    });

    await expect(service.withAssetLocalReadFile('660000000000000000000901', jest.fn()))
      .rejects.toMatchObject({ code: 'MEDIA_ASSET_FILE_NOT_FOUND' });
  });

  test('withAssetLocalReadFile materializes local asset from secureUrl when local file is missing', async () => {
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000901',
      provider: 'local',
      relativeStoragePath: 'missing.zip',
      secureUrl: 'https://res.cloudinary.com/cloud/raw/upload/file.zip',
      size: 3,
    });
    https.get.mockImplementation((url, callback) => {
      const response = Readable.from([Buffer.from('zip')]);
      response.statusCode = 200;
      process.nextTick(() => callback(response));
      return new EventEmitter();
    });
    let callbackPath;

    const result = await service.withAssetLocalReadFile('660000000000000000000901', async ({ localPath }) => {
      callbackPath = localPath;
      expect(await fs.promises.readFile(localPath, 'utf8')).toBe('zip');
      return 'read';
    });

    expect(result).toBe('read');
    expect(https.get).toHaveBeenCalledWith('https://res.cloudinary.com/cloud/raw/upload/file.zip', expect.any(Function));
    expect(fs.existsSync(callbackPath)).toBe(false);
  });

  test('withReadAccess cleans temporary local files after callback failure', async () => {
    const tempFile = path.join(root, 'tmp-read.zip');
    await fs.promises.writeFile(tempFile, Buffer.from('zip'));

    await expect(service.withReadAccess({
      mediaAsset: { _id: '660000000000000000000901' },
      localPath: tempFile,
      cleanup: async () => fs.promises.rm(tempFile, { force: true }),
    }, async () => {
      throw new Error('inspect failed');
    })).rejects.toThrow('inspect failed');

    expect(fs.existsSync(tempFile)).toBe(false);
  });

  test('withAssetLocalReadFile materializes Cloudinary asset to temporary file and cleans it', async () => {
    repository.findById.mockResolvedValue({
      _id: '660000000000000000000901',
      provider: 'cloudinary',
      secureUrl: 'https://res.cloudinary.com/cloud/image/upload/file.zip',
      size: 3,
    });
    https.get.mockImplementation((url, callback) => {
      const response = Readable.from([Buffer.from('zip')]);
      response.statusCode = 200;
      process.nextTick(() => callback(response));
      return new EventEmitter();
    });
    let callbackPath;

    const result = await service.withAssetLocalReadFile('660000000000000000000901', async ({ localPath }) => {
      callbackPath = localPath;
      expect(fs.existsSync(localPath)).toBe(true);
      expect(await fs.promises.readFile(localPath, 'utf8')).toBe('zip');
      return 'read';
    });

    expect(result).toBe('read');
    expect(https.get).toHaveBeenCalledWith('https://res.cloudinary.com/cloud/image/upload/file.zip', expect.any(Function));
    expect(fs.existsSync(callbackPath)).toBe(false);
  });

  test('assertMediaAssetExists returns asset or throws controlled 404', async () => {
    repository.findById.mockResolvedValueOnce({ _id: '660000000000000000000901' });
    await expect(service.assertMediaAssetExists('660000000000000000000901'))
      .resolves.toMatchObject({ _id: '660000000000000000000901' });

    repository.findById.mockResolvedValueOnce(null);
    await expect(service.assertMediaAssetExists('660000000000000000000902'))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 });
  });

  test('assertMediaAssetReady rejects an incomplete multipart asset', async () => {
    repository.findById.mockResolvedValue({ _id: '660000000000000000000901', uploadStatus: 'UPLOADING' });

    await expect(service.assertMediaAssetReady('660000000000000000000901'))
      .rejects.toMatchObject({ code: 'MEDIA_ASSET_NOT_READY', statusCode: 409 });
  });

  test('getAssetsByIds returns unique assets for non-empty ids only', async () => {
    repository.findByIds.mockResolvedValue([
      { _id: '660000000000000000000901', originalFilename: 'design.psd' },
    ]);

    const result = await service.getAssetsByIds([
      '660000000000000000000901',
      '660000000000000000000901',
      null,
    ]);

    expect(repository.findByIds).toHaveBeenCalledWith(['660000000000000000000901']);
    expect(result).toEqual([{ _id: '660000000000000000000901', originalFilename: 'design.psd' }]);
  });

  test('findAssetIdsByOriginalFilename delegates a normalized filename prefix', async () => {
    repository.findIdsByOriginalFilename.mockResolvedValue(['660000000000000000510007']);

    await expect(service.findAssetIdsByOriginalFilename('  master ')).resolves.toEqual([
      '660000000000000000510007',
    ]);
    expect(repository.findIdsByOriginalFilename).toHaveBeenCalledWith('master');
  });

  test('listAssets delegates validated query to repository', async () => {
    const page = { items: [], pagination: { total: 0, page: 1, limit: 20 } };
    repository.list.mockResolvedValue(page);
    await expect(service.listAssets({ status: 'ACTIVE', page: 1, limit: 20 })).resolves.toBe(page);
  });
});
