jest.mock('../../../src/modules/media/repositories/mediaAsset.repository', () => ({
  create: jest.fn(), findById: jest.fn(), markDiscardedIfMetadataMatches: jest.fn(),
}));
jest.mock('../../../src/modules/auth/public', () => ({ canAccessScope: jest.fn() }));
jest.mock('cloudinary', () => ({ v2: { config: jest.fn(), url: jest.fn(), uploader: { upload_stream: jest.fn(), destroy: jest.fn() } } }));
const { Readable, Writable } = require('stream');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const repository = require('../../../src/modules/media/repositories/mediaAsset.repository');
const auth = require('../../../src/modules/auth/public');
const service = require('../../../src/modules/media/services/mediaAsset.service');

describe('authenticated Cloudinary assets', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  let scratch;
  const asset = { _id: '660000000000000000000001', provider: 'cloudinary', deliveryType: 'authenticated',
    providerAssetId: 'mockups/cat', resourceType: 'image', mimeType: 'image/jpeg', size: 3,
    uploadStatus: 'READY', ownerType: 'LISTING_LAUNCH', shopId: '660000000000000000000002', secureUrl: 'https://do-not-expose.invalid/secret' };
  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret', MEDIA_STORAGE_PROVIDER: 'local' });
    scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'protected-media-test-'));
    process.env.MEDIA_STORAGE_ROOT = scratch;
    repository.findById.mockResolvedValue(asset);
    repository.create.mockImplementation(async value => ({ _id: asset._id, ...value }));
    cloudinary.url.mockReturnValue('https://res.cloudinary.com/test-cloud/image/authenticated/s--test--/mockups/cat.jpg');
    global.fetch = jest.fn().mockResolvedValue(new Response(Buffer.from('abc')));
  });
  afterEach(async () => { global.fetch = originalFetch; process.env = { ...originalEnv }; await fs.promises.rm(scratch, { recursive: true, force: true }); });

  test('hides protected media from public URL helpers', async () => {
    await expect(service.getPublicAssetUrl(asset._id)).resolves.toBeNull();
  });
  test('trusted upload override stores authenticated cloud bytes instead of local files', async () => {
    cloudinary.uploader.upload_stream.mockImplementation((options, done) => new Writable({
      write(chunk, encoding, callback) { callback(); },
      final(callback) { done(null, { public_id: 'mockups/new', resource_type: 'image', secure_url: 'https://res.cloudinary.com/test-cloud/image/authenticated/new.jpg' }); callback(); },
    }));
    const saved = await service.storeAsset({ stream: Readable.from([Buffer.from('abc')]), filename: 'cat.jpg', mimeType: 'image/jpeg',
      storageProvider: 'cloudinary', deliveryType: 'authenticated', maxBytes: 10 });
    expect(saved).toMatchObject({ provider: 'cloudinary', deliveryType: 'authenticated', size: 3 });
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(expect.objectContaining({ type: 'authenticated' }), expect.any(Function));
  });
  test('read uses provider identity and bounded signed fetch, not stored URL', async () => {
    const result = await service.readAuthenticatedAssetBuffer(asset._id, { maxBytes: 10, timeoutMs: 1000 });
    expect(result.buffer.toString()).toBe('abc');
    expect(cloudinary.url).toHaveBeenCalledWith('mockups/cat', expect.objectContaining({ type: 'authenticated', sign_url: true, secure: true }));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('res.cloudinary.com/test-cloud/'), expect.objectContaining({ redirect: 'error' }));
  });
  test('protected read rejects oversize bytes and non-ready assets', async () => {
    await expect(service.readAuthenticatedAssetBuffer(asset._id, { maxBytes: 2 })).rejects.toMatchObject({ code: 'MEDIA_ASSET_TOO_LARGE' });
    repository.findById.mockResolvedValue({ ...asset, discardedAt: new Date() });
    await expect(service.readAuthenticatedAssetBuffer(asset._id)).rejects.toMatchObject({ code: 'MEDIA_ASSET_NOT_READY' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('protected read stops when response body exceeds byte budget', async () => {
    global.fetch.mockResolvedValue(new Response(Buffer.from('abcdef')));
    await expect(service.readAuthenticatedAssetBuffer(asset._id, { maxBytes: 4 })).rejects.toMatchObject({ code: 'MEDIA_ASSET_TOO_LARGE' });
  });
  test('scoped catalog access is evaluated before a protected download', async () => {
    auth.canAccessScope.mockReturnValue(false);
    await expect(service.withAuthorizedAssetLocalReadFile(asset._id, {}, jest.fn())).rejects.toMatchObject({ statusCode: 403 });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(auth.canAccessScope).toHaveBeenCalledWith({}, 'CATALOG:WRITE', { scopeType: 'SHOP', scopeId: asset.shopId });
  });
  test('cleanup deletes with authenticated type and preserves legacy deletion defaults', async () => {
    repository.markDiscardedIfMetadataMatches.mockResolvedValue(asset);
    await service.discardUnattachedAsset(asset._id, { uploadToken: 'token' }, 'conflict');
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('mockups/cat', expect.objectContaining({ type: 'authenticated' }));
  });
  test('upload failure never falls back to local archive', async () => {
    delete process.env.CLOUDINARY_API_SECRET;
    await expect(service.storeAsset({ stream: Readable.from(['abc']), filename: 'cat.jpg', mimeType: 'image/jpeg',
      storageProvider: 'cloudinary', deliveryType: 'authenticated' })).rejects.toMatchObject({ code: 'MOCKUP_STORAGE_UNAVAILABLE' });
    expect(await fs.promises.readdir(scratch)).toEqual([]);
  });
  test('definitely unpersisted authenticated upload is cleaned after DB failure', async () => {
    cloudinary.uploader.upload_stream.mockImplementation((options, done) => new Writable({
      write(chunk, encoding, callback) { callback(); },
      final(callback) { done(null, { public_id: 'mockups/orphan', resource_type: 'image', secure_url: 'https://res.cloudinary.com/test-cloud/image/authenticated/orphan.jpg' }); callback(); },
    }));
    repository.create.mockRejectedValue(Object.assign(new Error('invalid record'), { name: 'ValidationError' }));
    repository.findById.mockResolvedValue(null);
    await expect(service.storeAsset({ stream: Readable.from(['abc']), filename: 'cat.jpg', mimeType: 'image/jpeg', storageProvider: 'cloudinary', deliveryType: 'authenticated' }))
      .rejects.toMatchObject({ code: 'MOCKUP_STORAGE_UNAVAILABLE' });
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('mockups/orphan', expect.objectContaining({ type: 'authenticated' }));
  });
  test('protected preview temporary file is removed even if consumer fails', async () => {
    auth.canAccessScope.mockReturnValue(true);
    let materialized;
    await expect(service.withAuthorizedAssetLocalReadFile(asset._id, {}, async ({ localPath }) => {
      materialized = localPath;
      expect(await fs.promises.readFile(localPath, 'utf8')).toBe('abc');
      throw new Error('client disconnected');
    })).rejects.toThrow('client disconnected');
    await expect(fs.promises.stat(materialized)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('ambiguous Mongo write retains cloud bytes even when immediate read has no record', async () => {
    cloudinary.uploader.upload_stream.mockImplementation((options, done) => new Writable({
      write(chunk, encoding, callback) { callback(); },
      final(callback) { done(null, { public_id: 'mockups/uncertain', resource_type: 'image' }); callback(); },
    }));
    repository.create.mockRejectedValue(new Error('network timeout'));
    repository.findById.mockResolvedValue(null);
    await expect(service.storeAsset({ stream: Readable.from(['abc']), filename: 'cat.jpg', mimeType: 'image/jpeg', storageProvider: 'cloudinary', deliveryType: 'authenticated' })).rejects.toMatchObject({ code: 'MOCKUP_STORAGE_UNAVAILABLE' });
    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
  });
});
