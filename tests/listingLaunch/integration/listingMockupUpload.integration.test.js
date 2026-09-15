const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const sharp = require('sharp');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
jest.mock('../../../src/modules/auth/public', () => ({
  ...jest.requireActual('../../../src/modules/auth/middlewares/authorization'),
  authenticate(req, res, next) { if (!req.headers['x-auth']) return res.sendStatus(401); req.auth = JSON.parse(req.headers['x-auth']); return next(); },
}));
jest.mock('../../../src/modules/media/public', () => ({ storeAsset: jest.fn(), getAsset: jest.fn(), discardUnattachedAsset: jest.fn(), assertAuthenticatedCloudinaryReady: jest.fn() }));
const media = require('../../../src/modules/media/public');
const Launch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
const Shop = require('../../../src/modules/shop/models/shop.model');
const { launchPayload } = require('../helpers/contentFixtures');
const app = express();
app.use(express.json());
app.use('/api/listing-launches', require('../../../src/modules/listingLaunch/routes'));
app.use(require('../../../src/middlewares/errorHandler'));
jest.setTimeout(30000);
let mongo, launch, identity, png;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'mockup_upload_test' });
  png = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff0000' } }).png().toBuffer();
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); }, 60000);
beforeEach(async () => {
  jest.clearAllMocks();
  await Launch.deleteMany({}); await Shop.deleteMany({});
  const shop = await Shop.create({ name: 'Mockup test' });
  launch = await Launch.create(launchPayload({ shopId: shop._id }));
  identity = { accountId: new mongoose.Types.ObjectId().toString(), scopes: [{ scopeType: 'shop', scopeId: String(shop._id), permissions: ['CATALOG:WRITE'] }] };
  media.storeAsset.mockImplementation(async (input) => {
    const chunks = []; for await (const c of input.stream) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    expect((await sharp(bytes).metadata()).format).toBe('jpeg');
    expect(input).toMatchObject({ storageProvider: 'cloudinary', deliveryType: 'authenticated', shopId: launch.shopId, ownerType: 'LISTING_LAUNCH' });
    return { _id: new mongoose.Types.ObjectId(), size: bytes.length, metadata: input.metadata };
  });
});
const upload = (bytes = png, auth = identity) => request(app).post(`/api/listing-launches/${launch._id}/mockup`)
  .set('x-auth', JSON.stringify(auth)).field('expectedMockupRevision', '0').field('expectedInputVersion', '1').attach('file', bytes, { filename: 'cat.png', contentType: 'image/png' });
test('upload normalizes, persists image pointer and invalidates content without changing garment facts', async () => {
  const res = await upload();
  expect(res.status).toBe(201);
  expect(res.body.data).toMatchObject({ mockupRevision: 1, contentInputVersion: 2, approvedContent: null, mockup: { width: 20, height: 10 } });
  const saved = await Launch.findById(launch._id).lean();
  expect(String(saved.mockupAssetId)).toBe(res.body.data.mockup.assetId);
  expect(saved.contentInputs.productFacts.material).toBe('Cotton');
  expect(JSON.stringify(res.body)).not.toMatch(/secureUrl|relativeStoragePath|cloudinary.com/);
});
test('concurrent replacement has one winner and discards only the losing new image', async () => {
  const results = await Promise.all([upload(), upload()]);
  expect(results.map(x => x.status).sort()).toEqual([201, 409]);
  const current = await Launch.findById(launch._id).lean();
  for (const [assetId] of media.discardUnattachedAsset.mock.calls) expect(String(assetId)).not.toBe(String(current.mockupAssetId));
});
test('invalid image bytes never reach cloud storage', async () => {
  expect((await upload(Buffer.from('invalid'))).status).toBe(400);
  expect(media.storeAsset).not.toHaveBeenCalled();
});
test('forbidden shop rejects before storage and decoding', async () => {
  expect((await upload(png, { ...identity, scopes: [] })).status).toBe(403);
  expect(media.storeAsset).not.toHaveBeenCalled();
});
test('missing cloud configuration never falls back to local storage', async () => {
  const AppError = require('../../../src/shared/errors/appError');
  media.assertAuthenticatedCloudinaryReady.mockImplementationOnce(() => { throw new AppError('Unavailable', 503, true, 'MOCKUP_STORAGE_UNAVAILABLE'); });
  expect((await upload()).status).toBe(503);
  expect(media.storeAsset).not.toHaveBeenCalled();
  expect((await Launch.findById(launch._id).lean()).mockupAssetId).toBeNull();
});
test('cloud failure preserves the current pointer and input version', async () => {
  const oldAsset = new mongoose.Types.ObjectId();
  await Launch.updateOne({ _id: launch._id }, { $set: { mockupAssetId: oldAsset } });
  media.storeAsset.mockRejectedValueOnce(new (require('../../../src/shared/errors/appError'))('Unavailable', 503, true, 'MOCKUP_STORAGE_UNAVAILABLE'));
  expect((await upload()).status).toBe(503);
  const saved = await Launch.findById(launch._id).lean();
  expect(String(saved.mockupAssetId)).toBe(String(oldAsset));
  expect(saved.contentInputVersion).toBe(1);
});
test('stale command rejects before a second cloud upload', async () => {
  expect((await upload()).status).toBe(201);
  expect((await upload()).status).toBe(409);
  expect(media.storeAsset).toHaveBeenCalledTimes(1);
});
test('upload rate limit is independent of image decoding success', async () => {
  for (let i = 0; i < 10; i += 1) expect((await upload(Buffer.from('invalid'))).status).toBe(400);
  expect((await upload()).status).toBe(429);
  expect(media.storeAsset).not.toHaveBeenCalled();
});
