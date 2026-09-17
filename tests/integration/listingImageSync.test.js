const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { Writable } = require('stream');
jest.mock('cloudinary', () => ({ v2: { config: jest.fn(), uploader: { upload_stream: jest.fn() } } }));
const cloudinary = require('cloudinary').v2;
const integration = require('../../src/modules/integration/public');
const catalog = require('../../src/modules/catalog/public');
const Listing = require('../../src/modules/catalog/models/listing.model');
const Agent = require('../../src/modules/integration/extensionCommand/models/extensionAgent.model');
const Command = require('../../src/modules/integration/extensionCommand/models/extensionCommand.model');
const extension = integration.extensionCommand;
const sync = integration.listingImageSync;
const oid = () => new mongoose.Types.ObjectId();
const admin = { permissions: ['CATALOG:READ', 'CATALOG:WRITE'] };
const image = { buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), mimetype: 'image/png' };
const sourceUrl = 'https://m.media-amazon.com/images/I/test.png';
let mongo, shopId, tokenId, agent, extAuth;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' }, instance: { dbName: 'listing_image_sync_test' } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  shopId = oid(); tokenId = oid();
  extAuth = { tokenType: 'EXTENSION', extensionTokenId: String(tokenId), scopes: [{ scopeType: 'shop', scopeId: String(shopId), permissions: ['ORDERS:WRITE'] }] };
  agent = await Agent.create({ shopId, extensionTokenId: tokenId, clientId: 'test', label: 'Test', lastSeenAt: new Date(), listingImageSync: true });
  process.env.CLOUDINARY_CLOUD_NAME = 'test'; process.env.CLOUDINARY_API_KEY = 'test'; process.env.CLOUDINARY_API_SECRET = 'test';
  cloudinary.uploader.upload_stream.mockReset().mockImplementation((options, callback) => new Writable({
    write(chunk, encoding, done) { done(); },
    final(done) { callback(null, { public_id: options.public_id, secure_url: `https://res.cloudinary.com/test/${options.public_id}`, resource_type: 'image' }); done(); },
  }));
});
async function listing(patch = {}) {
  return Listing.create({ shopId, sku: 'SKU', salesChannelCode: 'AMAZON', marketplaceCode: 'US', asin: `B${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`, title: 'Test', createdAt: new Date('2026-01-01'), ...patch });
}
async function request() { return sync.createJob({ shopId: String(shopId), agentId: String(agent._id) }, admin); }
async function claim() {
  const result = await extension.claimNext({ clientId: 'test' }, extAuth);
  const lease = { clientId: 'test', leaseToken: result.leaseToken };
  await extension.startCommand(result.command._id, lease, extAuth);
  const batch = await sync.getCommandItems(result.command._id, lease, extAuth);
  return { commandId: result.command._id, lease, batch };
}
async function acknowledge(batch, item, fields = {}, file = image) {
  return sync.recordResult(batch.commandId, item.id, { ...batch.lease, asin: item.asin, sourceUrl, ...fields }, file, extAuth);
}

test('manual ASIN allowlist cannot include other listings from the same shop', async () => {
  const asins = ['B0HDSWTSPD', 'B0HFM6K1GX', 'B0HJ2F5RQQ'];
  for (const asin of [...asins, 'B000000001']) await listing({ asin });
  const job = await sync.createJob({ shopId: String(shopId), agentId: String(agent._id), asins }, admin);
  expect(job.total).toBe(3);
  expect((await claim()).batch.items.map(item => item.asin).sort()).toEqual([...asins].sort());
});

test('legacy Amazon seller-import images can refresh, but explicit manual and unrelated URLs stay protected', async () => {
  const legacyUrl = 'https://m.media-amazon.com/images/S/gestalt-seller-images-prod-us-east-1/market/seller/image.png';
  const row = await listing({ asin: 'B0HDSWTSPD', productImageUrl: legacyUrl });
  await listing({ productImageUrl: legacyUrl, imageSync: { source: 'MANUAL' } });
  await listing({ productImageUrl: legacyUrl.replace('m.media-amazon.com', 'm.media-amazon.com.evil.test') });
  await listing({ productImageUrl: 'https://m.media-amazon.com/images/S/unrecognized/image.png' });
  expect((await catalog.findImageSyncCandidates({ shopId, manual: true })).map(value => String(value._id))).toEqual([String(row._id)]);
  expect(catalog.isAmazonImageUrl(legacyUrl)).toBe(true);
  await request();
  const batch = await claim();
  expect(await acknowledge(batch, batch.batch.items[0])).toEqual({ status: 'SUCCEEDED' });
  expect((await Listing.findById(row._id).lean()).productImageUrl).toMatch(/^https:\/\/res.cloudinary.com/);
});

test.each([[[]], [['invalid']], [['B0HDSWTSPD', 'B0HDSWTSPD']]])('rejects invalid ASIN selection rather than running the whole shop: %j', (asins) => {
  const schema = require('../../src/modules/integration/listingImageSync/validators/listingImageSync.validator').create;
  expect(schema.validate({ shopId: String(shopId), agentId: String(agent._id), asins }, { stripUnknown: true }).error).toBeDefined();
});

test('automatic discovery includes exact seven-day boundary and excludes recently checked and manual images', async () => {
  const now = new Date('2026-09-17T00:00:00Z');
  const boundary = await listing({ createdAt: new Date('2026-09-10T00:00:00Z') });
  await listing({ createdAt: new Date('2026-09-10T00:00:00.001Z') });
  await listing({ imageSync: { lastCheckedAt: new Date('2026-09-10T00:00:00.001Z') } });
  await listing({ productImageUrl: sourceUrl, imageSync: { source: 'MANUAL' } });
  await listing({ productImageUrl: 'https://example.com/legacy.jpg' });
  const imported = await listing({ productImageUrl: sourceUrl, imageSync: { lastCheckedAt: new Date('2026-09-10T00:00:00Z') } });
  expect((await catalog.findImageSyncCandidates({ shopId, now })).map((x) => String(x._id))).toEqual([String(imported._id), String(boundary._id)]);
});
test('request now bypasses time gates; batches at most 25, concurrency creates one active shop job', async () => {
  for (let index = 0; index < 27; index++) await listing({ createdAt: new Date() });
  const results = await Promise.allSettled([request(), request()]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const batch = await claim();
  expect(batch.batch.items).toHaveLength(25);
  expect(await Command.countDocuments({ type: 'SYNC_LISTING_IMAGES' })).toBe(1);
});
test.each([
  'https://m.media-amazon.com/images/W/BW_MEDIAX_AVIF_MEASUREMENT_1306696-T2/images/I/61GdTTezDrL._AC_SX679_.jpg',
  'https://m.media-amazon.com/future-layout/main-image',
])('accepts trusted CDN upload without interpreting its path: %s', async (sourceUrl) => {
  const row = await listing(); await request(); const batch = await claim();
  expect(await acknowledge(batch, batch.batch.items[0], { sourceUrl })).toEqual({ status: 'SUCCEEDED' });
  const saved = await Listing.findById(row._id).lean();
  expect(saved.productImageUrl).toMatch(/^https:\/\/res.cloudinary.com/);
  expect(saved.imageSync.sourceUrl).toBe(sourceUrl);
});

test.each(['http://m.media-amazon.com/a', 'https://u:p@m.media-amazon.com/a', 'https://m.media-amazon.com:8443/a', 'https://m.media-amazon.com.evil.test/a', 'https://evil.test/m.media-amazon.com/a'])('rejects untrusted CDN authority: %s', (value) => {
  expect(catalog.isAmazonImageUrl(value)).toBe(false);
});

test('valid result stores Cloudinary URL, duplicate acknowledgement is idempotent and unchanged bytes skip upload', async () => {
  const row = await listing(); await request(); const batch = await claim();
  expect(await acknowledge(batch, batch.batch.items[0])).toEqual({ status: 'SUCCEEDED' });
  expect(await acknowledge(batch, batch.batch.items[0])).toEqual({ status: 'SUCCEEDED' });
  const saved = await Listing.findById(row._id).lean();
  expect(saved.productImageUrl).toMatch(/^https:\/\/res.cloudinary.com/);
  expect(saved.imageSync).toMatchObject({ source: 'AMAZON_SYNC', hash: expect.any(String), mediaAssetId: expect.anything(), sourceUrl, lastCheckedAt: expect.any(Date) });
  await extension.completeCommand(batch.commandId, { ...batch.lease, success: true }, extAuth);
  await request(); const next = await claim();
  expect(await acknowledge(next, next.batch.items[0])).toEqual({ status: 'UNCHANGED' });
  expect(cloudinary.uploader.upload_stream).toHaveBeenCalledTimes(1);
});
test('manual edit during upload wins CAS and is not overwritten', async () => {
  const row = await listing(); await request(); const batch = await claim();
  cloudinary.uploader.upload_stream.mockImplementation((options, callback) => new Writable({ write(chunk, encoding, done) { done(); }, final(done) {
    Listing.updateOne({ _id: row._id }, { $set: { productImageUrl: 'https://example.com/manual.png', 'imageSync.source': 'MANUAL' } }).then(() => {
      callback(null, { public_id: options.public_id, secure_url: 'https://res.cloudinary.com/test/image', resource_type: 'image' }); done();
    }).catch(done);
  } }));
  expect(await acknowledge(batch, batch.batch.items[0])).toEqual({ status: 'SKIPPED' });
  expect((await Listing.findById(row._id).lean()).productImageUrl).toBe('https://example.com/manual.png');
});
test.each([
  [{ buffer: Buffer.from('<svg></svg>'), mimetype: 'image/png' }, sourceUrl],
  [{ buffer: Buffer.alloc(10 * 1024 * 1024 + 1), mimetype: 'image/png' }, sourceUrl],
  [image, 'https://m.media-amazon.com.evil.test/a.png'],
])('records untrusted images as failed before upload without redispatching them', async (file, url) => {
  await listing(); await request(); const batch = await claim();
  await expect(acknowledge(batch, batch.batch.items[0], { sourceUrl: url }, file)).resolves.toEqual({ status: 'FAILED' });
  expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
  expect((await sync.getCommandItems(batch.commandId, batch.lease, extAuth)).items).toHaveLength(0);
});
test('requires scoped user and exact extension ownership, ASIN, command item and unexpired running lease', async () => {
  await listing();
  await expect(sync.createJob({ shopId, agentId: agent._id }, { permissions: ['ORDERS:WRITE'] })).rejects.toMatchObject({ statusCode: 403 });
  await request(); const batch = await claim(); const item = batch.batch.items[0];
  await expect(acknowledge(batch, item, { asin: 'B000000BAD' })).rejects.toMatchObject({ statusCode: 409 });
  await expect(sync.getCommandItems(batch.commandId, batch.lease, { ...extAuth, extensionTokenId: String(oid()) })).rejects.toMatchObject({ statusCode: 403 });
  await expect(sync.recordResult(batch.commandId, String(oid()), { ...batch.lease, asin: item.asin, sourceUrl }, image, extAuth)).rejects.toMatchObject({ statusCode: 409 });
  await Command.updateOne({ _id: batch.commandId }, { $set: { leaseExpiresAt: new Date(0) } });
  await expect(acknowledge(batch, item)).rejects.toMatchObject({ statusCode: 409 });
});
test('lease loss resumes only unacknowledged items and explicit retry resets only failed items', async () => {
  await listing(); await listing(); await listing(); const job = await request(); const batch = await claim();
  await acknowledge(batch, batch.batch.items[0]);
  await acknowledge(batch, batch.batch.items[1], { errorCode: 'MISSING_IMAGE', errorMessage: 'Missing image' }, null);
  await Command.updateOne({ _id: batch.commandId }, { $set: { leaseExpiresAt: new Date(0) } });
  await sync.dispatch(); const resumed = await claim();
  expect(resumed.batch.items.map((x) => x.id)).toEqual([batch.batch.items[2].id]);
  await acknowledge(resumed, resumed.batch.items[0]);
  await extension.completeCommand(resumed.commandId, { ...resumed.lease, success: true }, extAuth);
  expect((await sync.listJobs({ page: 1, limit: 20 }, admin)).items[0]).toMatchObject({ status: 'COMPLETED_WITH_ERRORS', processed: 3, updated: 2, failed: 1 });
  await sync.changeJob(job.id, 'retry', admin); const retried = await claim();
  expect(retried.batch.items.map((x) => x.id)).toEqual([batch.batch.items[1].id]);
});
test('pause hides pending items, accepts in-flight result, resume retains pending checkpoint', async () => {
  await listing(); await listing(); const job = await request(); const batch = await claim();
  await sync.changeJob(job.id, 'pause', admin);
  expect(await sync.getCommandItems(batch.commandId, batch.lease, extAuth)).toMatchObject({ status: 'PAUSED', items: [] });
  await acknowledge(batch, batch.batch.items[0]);
  await extension.completeCommand(batch.commandId, { ...batch.lease, success: true }, extAuth);
  await sync.changeJob(job.id, 'resume', admin); const resumed = await claim();
  expect(resumed.batch.items.map((x) => x.id)).toEqual([batch.batch.items[1].id]);
});
test('daily empty eligibility creates no jobs; unsupported agents are not dispatched', async () => {
  await sync.upsertSchedule(String(agent._id), { enabled: true }, admin);
  await sync.dispatch();
  expect((await sync.listJobs({ page: 1, limit: 20 }, admin)).total).toBe(0);
  await listing(); await Agent.updateOne({ _id: agent._id }, { $set: { listingImageSync: false } });
  await expect(request()).rejects.toMatchObject({ statusCode: 409 });
  expect(await Command.countDocuments()).toBe(0);
});
test('concurrent acknowledgements produce one durable successful result', async () => {
  await listing(); await request(); const batch = await claim();
  const results = await Promise.allSettled([acknowledge(batch, batch.batch.items[0]), acknowledge(batch, batch.batch.items[0])]);
  expect(results.filter((result) => result.status === 'fulfilled').map((result) => result.value.status)).not.toContain('SKIPPED');
  expect((await sync.listJobs({ page: 1, limit: 20 }, admin)).items[0]).toMatchObject({ updated: 1, skipped: 0 });
  expect(await mongoose.model('MediaAsset').countDocuments()).toBe(1);
  expect(cloudinary.uploader.upload_stream).toHaveBeenCalledTimes(1);
});
test('image-result recovery after checkpoint write failure preserves successful result without another upload', async () => {
  const repo = require('../../src/modules/integration/listingImageSync/repositories/listingImageSync.repository');
  await listing(); await request(); const batch = await claim();
  const fail = jest.spyOn(repo, 'acknowledge').mockRejectedValueOnce(new Error('checkpoint unavailable'));
  await expect(acknowledge(batch, batch.batch.items[0])).rejects.toThrow('checkpoint unavailable');
  fail.mockRestore();
  expect(await acknowledge(batch, batch.batch.items[0])).toEqual({ status: 'SUCCEEDED' });
  expect(cloudinary.uploader.upload_stream).toHaveBeenCalledTimes(1);
});
test('unsupported heartbeat cannot claim a previously queued image command', async () => {
  await listing(); await request();
  await extension.heartbeat({ clientId: 'test', label: 'Old client' }, extAuth);
  expect(await extension.claimNext({ clientId: 'test' }, extAuth)).toBeNull();
});
test('missing Cloudinary configuration pauses without storing a local asset or acknowledging item', async () => {
  await listing(); await request(); const batch = await claim();
  delete process.env.CLOUDINARY_API_SECRET;
  await expect(acknowledge(batch, batch.batch.items[0])).rejects.toMatchObject({ statusCode: 503 });
  expect(await mongoose.model('MediaAsset').countDocuments()).toBe(0);
  expect(await sync.getCommandItems(batch.commandId, batch.lease, extAuth)).toMatchObject({ status: 'PAUSED', items: [] });
  expect((await sync.listJobs({ page: 1, limit: 20 }, admin)).items[0].processed).toBe(0);
});
test('concurrent dispatch and expired dispatch lock recovery never create competing batches', async () => {
  for (let index = 0; index < 26; index++) await listing();
  const job = await request(); const batch = await claim();
  await Promise.all([sync.dispatchJob(job.id), sync.dispatchJob(job.id)]);
  expect(await Command.countDocuments()).toBe(1);
  await Command.updateOne({ _id: batch.commandId }, { $set: { leaseExpiresAt: new Date(0) } });
  await Promise.all([sync.dispatchJob(job.id), sync.dispatchJob(job.id)]);
  expect(await Command.countDocuments({ status: 'QUEUED' })).toBe(1);
  const resumed = await claim();
  expect(resumed.batch.items.map((x) => x.id)).toEqual(batch.batch.items.map((x) => x.id));
});
test('saved per-item errors are bounded so a large checkpoint remains below the BSON document limit', async () => {
  await listing(); const job = await request(); const batch = await claim();
  await acknowledge(batch, batch.batch.items[0], { errorCode: 'FAILED', errorMessage: '界'.repeat(1000) }, null);
  const saved = await mongoose.model('ListingImageSyncJob').findById(job.id).lean();
  expect(saved.items[0].errorMessage).toHaveLength(300);
});
test('catalog manual editing the same URL or clearing it opts out of future sync', async () => {
  const listingService = require('../../src/modules/catalog/services/listing.service');
  const row = await listing({ qcStatus: 'APPROVED', productImageUrl: sourceUrl, imageSync: { source: 'IMPORTED' } });
  await listingService.updateListing(String(row._id), { productImageUrl: sourceUrl }, admin);
  expect((await Listing.findById(row._id).lean()).imageSync.source).toBe('MANUAL');
  await listingService.updateListing(String(row._id), { productImageUrl: null }, admin);
  await catalog.findOrCreateListingForOrderItem({ shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'US', asin: row.asin, sku: row.sku, productImageUrl: sourceUrl });
  expect((await Listing.findById(row._id).lean()).productImageUrl).toBeNull();
  expect(await catalog.findImageSyncCandidates({ shopId, manual: true })).toHaveLength(0);
});
test('daily schedule advances exactly one day and disabling preserves the active job', async () => {
  await listing(); await sync.upsertSchedule(String(agent._id), { enabled: true }, admin);
  const now = new Date(); await sync.dispatch(now);
  expect((await sync.listSchedules(admin)).items[0].nextRunAt.getTime()).toBe(now.getTime() + 86400000);
  const job = (await sync.listJobs({ page: 1, limit: 20 }, admin)).items[0];
  await sync.upsertSchedule(String(agent._id), { enabled: false }, admin);
  expect((await sync.listJobs({ page: 1, limit: 20 }, admin)).items[0].id).toBe(job.id);
  expect((await sync.listJobs({ page: 1, limit: 20 }, { scopes: [{ scopeType: 'shop', scopeId: String(oid()), permissions: ['CATALOG:READ'] }] })).total).toBe(0);
});
test.each([{ http_code: 400 }, { code: 'ETIMEDOUT' }])('Cloudinary rejection or network failure is durable FAILED until explicit retry', async (failure) => {
  await listing(); await request(); const batch = await claim();
  cloudinary.uploader.upload_stream.mockImplementation((options, callback) => new Writable({ write(chunk, encoding, done) { done(); }, final(done) { callback(failure); done(); } }));
  expect(await acknowledge(batch, batch.batch.items[0])).toEqual({ status: 'FAILED' });
  await extension.completeCommand(batch.commandId, { ...batch.lease, success: true }, extAuth);
  await sync.dispatch();
  expect(await extension.claimNext({ clientId: 'test' }, extAuth)).toBeNull();
  expect((await sync.listJobs({ page: 1, limit: 20 }, admin)).items[0]).toMatchObject({ status: 'COMPLETED_WITH_ERRORS', failed: 1 });
});
test('legacy empty-string image is eligible and preserves its exact value in the CAS filter', async () => {
  await listing({ productImageUrl: '' }); await request(); const batch = await claim();
  expect(await acknowledge(batch, batch.batch.items[0])).toEqual({ status: 'SUCCEEDED' });
});
