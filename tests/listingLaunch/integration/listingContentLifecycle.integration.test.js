const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../../src/modules/auth/public', () => ({
  ...jest.requireActual('../../../src/modules/auth/middlewares/authorization'),
  authenticate(req, res, next) {
    if (!req.headers['x-auth-context']) return res.status(401).json({ success: false });
    req.auth = JSON.parse(req.headers['x-auth-context']);
    return next();
  },
}));
jest.mock('../../../src/modules/listingLaunch/queues/listingContent.queue', () => ({
  assertQueueReady: jest.fn(), enqueueGeneration: jest.fn(),
}));

const config = require('../../../src/config');
const Shop = require('../../../src/modules/shop/models/shop.model');
const Group = require('../../../src/modules/catalog/models/productTypeGroup.model');
const Template = require('../../../src/modules/catalog/models/internalTemplate.model');
const Listing = require('../../../src/modules/catalog/models/listing.model');
const ListingVariant = require('../../../src/modules/catalog/models/listingVariant.model');
const DesignTask = require('../../../src/modules/design/models/designTask.model');
const MediaAsset = require('../../../src/modules/media/models/mediaAsset.model');
const Launch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
const Run = require('../../../src/modules/listingLaunch/models/listingContentRun.model');
const Version = require('../../../src/modules/listingLaunch/models/listingContentVersion.model');
const queue = require('../../../src/modules/listingLaunch/queues/listingContent.queue');
const { processGeneration, recoverGenerationRuns } = require('../../../src/modules/listingLaunch/services/listingContentGeneration.service');
const { inputs, content } = require('../helpers/contentFixtures');
const app = express();
app.use(express.json());
app.use('/api/listing-launches', require('../../../src/modules/listingLaunch/routes'));
app.use(require('../../../src/middlewares/errorHandler'));

jest.setTimeout(30000);
const base = '/api/listing-launches';
const originalConfig = config.listingContent;
const originalFetch = global.fetch;
const { confirmedBy, confirmedAt, ...inputFields } = inputs;
const inputCommand = { ...inputFields, expectedInputVersion: 1 };
const command = { requestKey: '11111111-1111-4111-8111-111111111111', expectedInputVersion: 2 };
const nextCommand = { ...command, requestKey: '22222222-2222-4222-8222-222222222222' };
const forbiddenModels = [Listing, ListingVariant, DesignTask, MediaAsset];
const forbiddenCollections = new Set(forbiddenModels.map((model) => model.collection.name));
let mongo;
let auth;
let launch;
let otherLaunch;
let writes;
const headers = (identity = auth) => ({ 'x-auth-context': JSON.stringify(identity) });
const path = (suffix = '', id = launch.id) => `${base}/${id}${suffix}`;
const generation = (payload = command) => request(app).post(path('/content-generations')).set(headers()).send(payload);
const poll = (id) => request(app).get(path(`/content-generations/${id}`)).set(headers());
const providerResponse = (output = content) => ({
  ok: true, headers: new Headers({ 'x-request-id': 'req_mock_pilot' }),
  json: async () => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }),
});

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'listing_content_http_test', monitorCommands: true });
  await Promise.all([Launch, Run, Version, ...forbiddenModels].map((model) => model.init()));
  mongoose.connection.getClient().on('commandStarted', (event) => {
    if (writes && ['insert', 'update', 'delete', 'findAndModify'].includes(event.commandName)
      && forbiddenCollections.has(event.command[event.commandName])) writes.push(event.commandName);
  });
}, 60000);
afterAll(async () => {
  config.listingContent = originalConfig;
  global.fetch = originalFetch;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
}, 60000);
beforeEach(async () => {
  writes = null;
  await Promise.all([Shop, Group, Template, Launch, Run, Version].map((model) => model.deleteMany({})));
  jest.clearAllMocks();
  config.listingContent = { enabled: true, apiKey: 'mock-only-key', model: 'mock-only-model', timeoutMs: 90000 };
  global.fetch = jest.fn().mockImplementation(async () => providerResponse());
  queue.assertQueueReady.mockResolvedValue(undefined);
  queue.enqueueGeneration.mockResolvedValue(undefined);
  const shop = await Shop.create({ name: 'HTTP pilot' });
  const group = await Group.create({ code: 'HTTP_TEE', name: 'T-shirt' });
  const template = await Template.create({ code: 'HTTP_FRONT', name: 'Front', productTypeGroupId: group.id });
  auth = { accountId: new mongoose.Types.ObjectId().toString(), scopes: [
    { scopeType: 'shop', scopeId: shop.id, permissions: ['CATALOG:WRITE'] },
  ] };
  writes = [];
  launch = (await request(app).post(base).set(headers())
    .send({ shopId: shop.id, marketplaceCode: 'AMAZON_US', brief: 'Cat shirt' }).expect(201)).body.data;
  otherLaunch = (await request(app).post(base).set(headers())
    .send({ shopId: shop.id, marketplaceCode: 'AMAZON_US', brief: 'Other shirt' }).expect(201)).body.data;
  await request(app).post(path('/select-product')).set(headers())
    .send({ productTypeGroupId: group.id, internalTemplateId: template.id }).expect(200);
});
afterEach(async () => {
  expect(writes).toEqual([]);
  expect(await Promise.all(forbiddenModels.map((model) => model.countDocuments()))).toEqual([0, 0, 0, 0]);
});

test('HTTP lifecycle preserves AI history, creates a manual version, and rejects approval after inputs change', async () => {
  const saved = await request(app).put(path('/content-inputs')).set(headers()).send(inputCommand).expect(200);
  expect(saved.body.data).toMatchObject({ contentInputVersion: 2, contentInputs: { confirmedBy: auth.accountId } });
  const accepted = await generation().expect(202);
  const runId = accepted.body.data.id;
  expect(accepted.body.data).toMatchObject({ status: 'QUEUED', usage: null, resultVersionId: null });
  expect((await poll(runId).expect(200)).body.data.status).toBe('QUEUED');
  expect(queue.enqueueGeneration).toHaveBeenCalledWith(runId);
  expect(global.fetch).not.toHaveBeenCalled();
  await processGeneration(runId);
  await processGeneration(runId); // Duplicate delivery must not make a second paid request.
  const succeeded = (await poll(runId).expect(200)).body.data;
  expect(succeeded).toMatchObject({ status: 'SUCCEEDED', usage: null, providerRequestId: 'req_mock_pilot' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(succeeded.resultVersionId).toMatch(/^[a-f\d]{24}$/);
  for (const field of ['inputSnapshot', 'requestHash', 'leaseExpiresAt', 'apiKey', 'rawResponse']) expect(succeeded).not.toHaveProperty(field);
  const versions = (await request(app).get(path('/content-versions')).set(headers()).expect(200)).body.data;
  expect(versions).toMatchObject({ total: 1, page: 1, limit: 20, items: [{ source: 'AI', version: 1, isStale: false, content }] });
  const revised = (await request(app).post(path(`/content-versions/${succeeded.resultVersionId}/revisions`))
    .set(headers()).send({ ...content, title: 'Seller reviewed cat shirt' }).expect(201)).body.data;
  expect(revised).toMatchObject({ source: 'MANUAL', version: 2, parentVersionId: succeeded.resultVersionId, runId: null, isStale: false });
  const approved = await request(app).post(path(`/content-versions/${revised.id}/approve`)).set(headers())
    .send({ expectedInputVersion: 2, selectedColorCodes: ['BLACK'] }).expect(200);
  expect(approved.body.data).toMatchObject({ state: 'PRODUCT_SELECTED', approvedContentUsable: true,
    approvedContent: { versionId: revised.id, approvedBy: auth.accountId } });
  const detail = (await request(app).get(path()).set(headers()).expect(200)).body.data;
  expect(detail).toMatchObject({ latestRun: { id: runId, status: 'SUCCEEDED' }, approvedContentUsable: true });
  await request(app).put(path('/content-inputs')).set(headers())
    .send({ ...inputCommand, keyword: 'New keyword', expectedInputVersion: 2 }).expect(200);
  expect((await request(app).get(path()).set(headers()).expect(200)).body.data)
    .toMatchObject({ contentInputVersion: 3, approvedContent: null, approvedContentUsable: false });
  await request(app).post(path(`/content-versions/${revised.id}/approve`)).set(headers())
    .send({ expectedInputVersion: 3, selectedColorCodes: ['BLACK'] }).expect(409);
  const history = (await request(app).get(path('/content-versions')).set(headers()).expect(200)).body.data;
  expect(history.items.map((item) => item.isStale)).toEqual([true, true]);
  expect(history.items[1].content).toEqual(content);
  config.listingContent.enabled = false;
  expect((await generation().expect(200)).body.data.id).toBe(runId);
  await generation({ ...command, expectedInputVersion: 3 }).expect(409);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('failed provider validation is visible through polling; only a new request key creates a retry', async () => {
  await request(app).put(path('/content-inputs')).set(headers()).send(inputCommand).expect(200);
  global.fetch.mockImplementationOnce(async () => providerResponse({ ...content,
    recommendedColors: [{ code: 'PURPLE', reason: 'Not available' }] }));
  const runId = (await generation().expect(202)).body.data.id;
  await expect(processGeneration(runId)).rejects.toMatchObject({ code: 'CONTENT_VALIDATION_FAILED' });
  const failed = (await poll(runId).expect(200)).body.data;
  expect(failed).toMatchObject({ status: 'FAILED', resultVersionId: null, usage: null,
    errorCode: 'CONTENT_VALIDATION_FAILED', validationErrors: [{ field: 'recommendedColors[0].code', code: 'COLOR_NOT_ALLOWED' }] });
  expect((await generation().expect(200)).body.data.id).toBe(runId);
  expect(await Version.countDocuments()).toBe(0);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const retryId = (await generation(nextCommand).expect(202)).body.data.id;
  expect(retryId).not.toBe(runId);
  await processGeneration(retryId);
  expect((await poll(retryId).expect(200)).body.data.status).toBe('SUCCEEDED');
  expect(await Run.countDocuments()).toBe(2);
  expect(await Version.countDocuments()).toBe(1);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('all P2 endpoints enforce identity and current exact-shop access before provider calls', async () => {
  const childId = new mongoose.Types.ObjectId().toString();
  const routes = [
    ['put', '/content-inputs', inputCommand], ['post', '/content-generations', command],
    ['get', `/content-generations/${childId}`], ['get', '/content-versions'],
    ['post', `/content-versions/${childId}/revisions`, content],
    ['post', `/content-versions/${childId}/approve`, { expectedInputVersion: 2, selectedColorCodes: ['BLACK'] }],
  ];
  for (const [method, suffix, payload] of routes) {
    await request(app)[method](path(suffix)).send(payload).expect(401);
    for (const scope of [
      { ...auth.scopes[0], scopeId: new mongoose.Types.ObjectId().toString() },
      { ...auth.scopes[0], validUntil: '2020-01-01' },
      { ...auth.scopes[0], validFrom: '2999-01-01' },
    ]) await request(app)[method](path(suffix)).set(headers({ ...auth, scopes: [scope] })).send(payload).expect(403);
  }
  const reader = { ...auth, scopes: [{ ...auth.scopes[0], permissions: ['CATALOG:READ'] }] };
  await request(app).get(path('/content-versions')).set(headers(reader)).expect(200);
  await request(app).post(path('/content-generations')).set(headers(reader)).send(command).expect(403);
  expect(await Run.countDocuments()).toBe(0);
  expect((await Launch.findById(launch.id).lean()).contentInputs).toBeNull();
  expect(queue.assertQueueReady).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('new work fails with 503 when disabled or Redis is unavailable, without reserving a run or calling provider', async () => {
  await request(app).put(path('/content-inputs')).set(headers()).send(inputCommand).expect(200);
  config.listingContent.enabled = false;
  expect((await generation().expect(503)).body.error.code).toBe('CONTENT_GENERATION_UNAVAILABLE');
  expect(queue.assertQueueReady).not.toHaveBeenCalled();
  config.listingContent.enabled = true;
  queue.assertQueueReady.mockRejectedValueOnce(new Error('Redis unavailable'));
  await generation().expect(503);
  expect(await Run.countDocuments()).toBe(0);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('dispatch failure retains durable 202, same-key replay, active conflict and recovery with no hidden provider retry', async () => {
  await request(app).put(path('/content-inputs')).set(headers()).send(inputCommand).expect(200);
  queue.enqueueGeneration.mockRejectedValueOnce(new Error('Dispatch unavailable'));
  const accepted = await generation().expect(202);
  const runId = accepted.body.data.id;
  expect(accepted.body.dispatchWarning).toEqual(expect.any(String));
  expect((await poll(runId).expect(200)).body.data).toMatchObject({ status: 'QUEUED', errorCode: 'CONTENT_DISPATCH_PENDING' });
  expect((await generation().expect(202)).body.data.id).toBe(runId);
  await generation(nextCommand).expect(409);
  expect(global.fetch).not.toHaveBeenCalled();
  await recoverGenerationRuns();
  expect((await poll(runId).expect(200)).body.data).toMatchObject({ status: 'QUEUED', errorCode: null });
  expect(await Run.countDocuments()).toBe(1);
  await processGeneration(runId);
  expect((await poll(runId).expect(200)).body.data.status).toBe('SUCCEEDED');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('run and version child IDs cannot cross launch boundaries; uppercase IDs normalize to scalar lowercase DTOs', async () => {
  await request(app).put(path('/content-inputs')).set(headers()).send(inputCommand).expect(200);
  const runId = (await generation().expect(202)).body.data.id;
  await processGeneration(runId);
  const versionId = (await poll(runId).expect(200)).body.data.resultVersionId;
  const response = await request(app).get(path(`/content-generations/${runId.toUpperCase()}`, launch.id.toUpperCase())).set(headers()).expect(200);
  expect(response.body.data).toMatchObject({ id: runId, launchId: launch.id, shopId: auth.scopes[0].scopeId });
  await request(app).get(path(`/content-generations/${runId}`, otherLaunch.id)).set(headers()).expect(404);
  await request(app).post(path(`/content-versions/${versionId}/revisions`, otherLaunch.id)).set(headers()).send(content).expect(404);
  await request(app).post(path(`/content-versions/${versionId}/approve`, otherLaunch.id)).set(headers())
    .send({ expectedInputVersion: 0, selectedColorCodes: ['BLACK'] }).expect(404);
  await request(app).get(path(`/content-generations/${new mongoose.Types.ObjectId()}`)).set(headers()).expect(404);
  expect(await Version.countDocuments()).toBe(1);
  expect((await Launch.findById(otherLaunch.id).lean()).approvedContent).toBeNull();
});
