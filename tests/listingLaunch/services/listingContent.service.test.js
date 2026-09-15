jest.mock('../../../src/config', () => ({ listingContent: { enabled: true, model: 'test-model', apiKey: 'test-key' } }));
jest.mock('../../../src/modules/catalog/public', () => ({ getProductTypeGroupById: jest.fn(), getInternalTemplateById: jest.fn() }));
jest.mock('../../../src/modules/shop/public', () => ({ assertShopIsActive: jest.fn() }));
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Launch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
const Run = require('../../../src/modules/listingLaunch/models/listingContentRun.model');
const Version = require('../../../src/modules/listingLaunch/models/listingContentVersion.model');
const service = require('../../../src/modules/listingLaunch/services/listingContent.service');
const catalog = require('../../../src/modules/catalog/public');
const shop = require('../../../src/modules/shop/public');
const config = require('../../../src/config');
const { ids, launchPayload } = require('../helpers/contentFixtures');
jest.setTimeout(30000);
const writer = { accountId: ids.accountId, scopes: [{ scopeType: 'shop', scopeId: ids.shopId, permissions: ['CATALOG:WRITE'] }] };
const reader = { ...writer, scopes: [{ scopeType: 'shop', scopeId: ids.shopId, permissions: ['CATALOG:READ'] }] };
const command = { requestKey: '11111111-1111-4111-8111-111111111111', expectedInputVersion: 1 };
let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'listing_content_service_test' });
  await Promise.all([Launch.init(), Run.init(), Version.init()]);
}, 60000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); }, 60000);
beforeEach(async () => {
  await Promise.all([Launch.deleteMany({}), Run.deleteMany({}), Version.deleteMany({})]);
  jest.clearAllMocks();
  config.listingContent = { enabled: true, model: 'test-model', apiKey: 'test-key' };
  catalog.getProductTypeGroupById.mockResolvedValue({ code: 'TEE', name: 'T-shirt', printMethod: 'DTG', status: 'ACTIVE' });
  catalog.getInternalTemplateById.mockResolvedValue({ code: 'FRONT', name: 'Front', status: 'ACTIVE', productTypeGroupId: { _id: ids.productTypeGroupId.toUpperCase() } });
  shop.assertShopIsActive.mockResolvedValue({});
});

test('reserves once across simultaneous identical requests and snapshots only allowed inputs', async () => {
  const launch = await Launch.create(launchPayload());
  const results = await Promise.all([1, 2, 3].map(() => service.requestGeneration(String(launch._id), command, writer)));
  expect(new Set(results.map(({ run }) => run.id)).size).toBe(1);
  expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
  expect(results[0].run).toMatchObject({ status: 'QUEUED', model: 'test-model', provider: 'OPENAI', usage: null });
  expect(results[0].run).not.toHaveProperty('inputSnapshot');
  expect(await Run.countDocuments({})).toBe(1);
  expect(await Version.countDocuments({})).toBe(0);
  const stored = await Run.findOne({}).lean();
  expect(stored.inputSnapshot.catalog.internalTemplate).toEqual({ code: 'FRONT', name: 'Front' });
  expect(stored.inputSnapshot.productTypeGroupId).toBe(ids.productTypeGroupId);
  expect(JSON.stringify(stored)).not.toContain('test-key');
});

test('same command replays completed run before current freshness or provider readiness', async () => {
  const launch = await Launch.create(launchPayload());
  const first = await service.requestGeneration(String(launch._id), command, writer);
  await Run.updateOne({ _id: first.run.id }, { $set: { status: 'FAILED', finishedAt: new Date(), errorCode: 'WORKER_INTERRUPTED', errorMessage: 'Generation was interrupted' } });
  await Launch.updateOne({ _id: launch._id }, { $inc: { contentInputVersion: 1 } });
  config.listingContent.enabled = false;
  const replay = await service.requestGeneration(String(launch._id), command, writer);
  expect(replay).toMatchObject({ replayed: true, run: { id: first.run.id, status: 'FAILED', errorCode: 'WORKER_INTERRUPTED' } });
  await expect(service.requestGeneration(String(launch._id), { ...command, expectedInputVersion: 2 }, writer)).rejects.toMatchObject({ statusCode: 409 });
});

test('enforces exact-shop access and launch ownership when polling', async () => {
  const launch = await Launch.create(launchPayload());
  await expect(service.requestGeneration(String(launch._id), command, reader)).rejects.toMatchObject({ statusCode: 403 });
  const accepted = await service.requestGeneration(String(launch._id), command, writer);
  expect(await service.getGeneration(String(launch._id), accepted.run.id, reader)).toMatchObject({ id: accepted.run.id });
  await expect(service.getGeneration(String(launch._id), accepted.run.id, {})).rejects.toMatchObject({ statusCode: 403 });
  const other = await Launch.create(launchPayload());
  await expect(service.getGeneration(String(other._id), accepted.run.id, writer)).rejects.toMatchObject({ statusCode: 404 });
});

test('rejects stale, busy, unconfigured, unsupported and inactive references without creating another run', async () => {
  const launch = await Launch.create(launchPayload());
  await expect(service.requestGeneration(String(launch._id), { ...command, expectedInputVersion: 0 }, writer)).rejects.toMatchObject({ statusCode: 409 });
  config.listingContent.model = '';
  await expect(service.requestGeneration(String(launch._id), command, writer)).rejects.toMatchObject({ statusCode: 503 });
  config.listingContent.model = 'test-model';
  catalog.getInternalTemplateById.mockResolvedValueOnce({ status: 'ACTIVE', productTypeGroupId: ids.shopId });
  await expect(service.requestGeneration(String(launch._id), command, writer)).rejects.toMatchObject({ statusCode: 409 });
  catalog.getProductTypeGroupById.mockResolvedValueOnce({ status: 'INACTIVE' });
  await expect(service.requestGeneration(String(launch._id), command, writer)).rejects.toMatchObject({ statusCode: 409 });
  const unsupported = await Launch.create(launchPayload({ marketplaceCode: 'AMAZON_CA' }));
  await expect(service.requestGeneration(String(unsupported._id), command, writer)).rejects.toMatchObject({ statusCode: 409 });
  expect(await Run.countDocuments({})).toBe(0);
  await service.requestGeneration(String(launch._id), command, writer);
  await expect(service.requestGeneration(String(launch._id), { ...command, requestKey: '22222222-2222-4222-8222-222222222222' }, writer)).rejects.toMatchObject({ statusCode: 409 });
  expect(await Run.countDocuments({})).toBe(1);
});
