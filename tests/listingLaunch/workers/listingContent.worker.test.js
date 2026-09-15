jest.mock('../../../src/modules/listingLaunch/adapters/openaiContent.adapter', () => ({ generateContent: jest.fn() }));
jest.mock('../../../src/modules/listingLaunch/queues/listingContent.queue', () => ({ assertQueueReady: jest.fn(), enqueueGeneration: jest.fn() }));
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Launch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
const Run = require('../../../src/modules/listingLaunch/models/listingContentRun.model');
const Version = require('../../../src/modules/listingLaunch/models/listingContentVersion.model');
const repository = require('../../../src/modules/listingLaunch/repositories/listingContent.repository');
const adapter = require('../../../src/modules/listingLaunch/adapters/openaiContent.adapter');
const queue = require('../../../src/modules/listingLaunch/queues/listingContent.queue');
const { processGeneration, recoverGenerationRuns } = require('../../../src/modules/listingLaunch/services/listingContentGeneration.service');
const { toListingContentRunDto } = require('../../../src/modules/listingLaunch/dtos/listingContent.dto');
const { validateContent } = require('../../../src/modules/listingLaunch/services/listingContentValidation');
const { launchPayload, runPayload, content } = require('../helpers/contentFixtures');
jest.setTimeout(30000);
let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'listing_content_worker_test' });
  await Promise.all([Launch.init(), Run.init(), Version.init()]);
}, 60000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); }, 60000);
beforeEach(async () => {
  await Promise.all([Launch.deleteMany({}), Run.deleteMany({}), Version.deleteMany({})]);
  jest.resetAllMocks();
  adapter.generateContent.mockResolvedValue({ content, usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 }, providerRequestId: 'req_test' });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
async function queuedRun(overrides = {}) {
  const launch = await Launch.create(launchPayload());
  return Run.create(runPayload(launch._id, overrides));
}

test('duplicate delivery calls provider once and commits one immutable reserved version with usage', async () => {
  const run = await queuedRun();
  await Promise.all([processGeneration(String(run._id)), processGeneration(String(run._id))]);
  expect(adapter.generateContent).toHaveBeenCalledTimes(1);
  const stored = await Run.findById(run._id).lean();
  expect(stored).toMatchObject({ status: 'SUCCEEDED', providerRequestId: 'req_test', usage: { totalTokens: 15 } });
  expect(stored.finishedAt).toBeInstanceOf(Date);
  const versions = await Version.find({ runId: run._id }).lean();
  expect(versions).toHaveLength(1);
  expect(String(versions[0]._id)).toBe(String(run.resultVersionId));
  expect(versions[0]).toMatchObject({ source: 'AI', version: 1, content });
  expect((await Launch.findById(run.launchId).lean()).contentVersionCounter).toBe(1);
  await processGeneration(String(run._id));
  expect(adapter.generateContent).toHaveBeenCalledTimes(1);
});

test('validation failure persists safe fields, preserves usage, inserts no version, and permits a new key', async () => {
  const run = await queuedRun();
  adapter.generateContent.mockImplementationOnce(async ({ snapshot }) => {
    try { validateContent({ ...content, recommendedColors: [{ code: 'VINTAGE_BLACK', reason: 'raw-secret' }] },
      { ...snapshot, availableColors: ['BLACK', 'NAVY', 'WHITE'].map((code) => ({ code, label: code })) }); }
    catch (error) { error.usage = { inputTokens: 7, outputTokens: 3, totalTokens: 10 }; error.providerRequestId = 'req_invalid'; throw error; }
  });
  await expect(processGeneration(String(run._id))).rejects.toMatchObject({ code: 'CONTENT_VALIDATION_FAILED' });
  const stored = await Run.findById(run._id).lean();
  expect(toListingContentRunDto(stored)).toMatchObject({ status: 'FAILED', errorCode: 'CONTENT_VALIDATION_FAILED',
    usage: { totalTokens: 10 }, providerRequestId: 'req_invalid', validationErrors: [{ field: 'recommendedColors[0].code', code: 'COLOR_NOT_ALLOWED' }] });
  expect(stored.finishedAt).toBeInstanceOf(Date);
  expect(JSON.stringify(stored)).not.toContain('raw-secret');
  expect(await Version.countDocuments({})).toBe(0);
  expect((await Launch.findById(run.launchId).lean()).contentVersionCounter).toBe(0);
  const retry = await repository.reserveGeneration(runPayload(run.launchId, { requestKey: '22222222-2222-4222-8222-222222222222' }));
  expect(retry.run.status).toBe('QUEUED');
});

test('expired running run fails without retry and late provider result cannot create content', async () => {
  const run = await queuedRun();
  let respond;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  adapter.generateContent.mockImplementationOnce(() => { started(); return new Promise((resolve) => { respond = resolve; }); });
  const work = processGeneration(String(run._id));
  const failed = expect(work).rejects.toMatchObject({ code: 'CONTENT_GENERATION_LEASE_EXPIRED' });
  await began;
  await Run.updateOne({ _id: run._id }, { $set: { leaseExpiresAt: new Date(Date.now() - 1) } });
  await recoverGenerationRuns();
  respond({ content });
  await failed;
  expect(await Run.findById(run._id).lean()).toMatchObject({ status: 'FAILED', errorCode: 'WORKER_INTERRUPTED' });
  expect(await Version.countDocuments({})).toBe(0);
  expect((await Launch.findById(run.launchId).lean()).contentVersionCounter).toBe(0);
  expect(queue.enqueueGeneration).not.toHaveBeenCalled();
  await processGeneration(String(run._id));
  expect(adapter.generateContent).toHaveBeenCalledTimes(1);
});

test('80 second asynchronous provider wait retains Mongo claim against duplicate delivery', async () => {
  const run = await queuedRun();
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  adapter.generateContent.mockImplementationOnce(() => {
    // Mongo is already running; only fake time inside the provider wait.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'performance', 'hrtime'] });
    started();
    return new Promise((resolve) => setTimeout(() => resolve({ content }), 80000));
  });
  const work = processGeneration(String(run._id));
  await began;
  await processGeneration(String(run._id));
  await jest.advanceTimersByTimeAsync(80000);
  jest.useRealTimers();
  await work;
  expect(adapter.generateContent).toHaveBeenCalledTimes(1);
  expect(await Run.findById(run._id).lean()).toMatchObject({ status: 'SUCCEEDED' });
});

test('recovery dispatches durable queued rows, continues past failures, and is bounded to 100', async () => {
  const runs = await Promise.all(Array.from({ length: 102 }, () => queuedRun()));
  queue.enqueueGeneration.mockRejectedValueOnce(new Error('offline-secret'));
  const recovered = await recoverGenerationRuns();
  expect(queue.enqueueGeneration).toHaveBeenCalledTimes(100);
  expect(recovered).toMatchObject({ queued: 100, dispatchFailures: 1 });
  expect(runs.map((run) => String(run._id))).toContain(queue.enqueueGeneration.mock.calls[0][0]);
  expect(await Run.countDocuments({ status: 'QUEUED' })).toBe(102);
});

test('unknown errors never persist or throw raw provider bodies or secrets', async () => {
  const run = await queuedRun();
  adapter.generateContent.mockRejectedValueOnce(Object.assign(new Error('sk-secret body'), { details: { fieldErrors: [{ field: 'sk-secret', message: 'sk-secret' }] } }));
  await expect(processGeneration(String(run._id))).rejects.toMatchObject({ code: 'CONTENT_GENERATION_FAILED', message: 'Content generation failed' });
  const stored = await Run.findById(run._id).lean();
  expect(stored).toMatchObject({ status: 'FAILED', validationErrors: [] });
  expect(JSON.stringify(stored)).not.toContain('sk-secret');
});

test('claim failures are safe queue failures and never call the provider', async () => {
  jest.spyOn(repository, 'claimGeneration').mockRejectedValueOnce(new Error('private-connection-secret'));
  await expect(processGeneration('invalid')).rejects.toMatchObject({ code: 'CONTENT_GENERATION_FAILED', message: 'Content generation failed' });
  expect(adapter.generateContent).not.toHaveBeenCalled();
});

test('failure persistence outage leaves lease recovery as fallback without a paid retry', async () => {
  const run = await queuedRun();
  adapter.generateContent.mockRejectedValueOnce(new Error('provider body'));
  jest.spyOn(repository, 'failGeneration').mockRejectedValueOnce(new Error('database unavailable'));
  await expect(processGeneration(String(run._id))).rejects.toMatchObject({ code: 'CONTENT_GENERATION_FAILED' });
  expect(await Run.findById(run._id).lean()).toMatchObject({ status: 'RUNNING' });
  await Run.updateOne({ _id: run._id }, { $set: { leaseExpiresAt: new Date(Date.now() - 1) } });
  await recoverGenerationRuns();
  await processGeneration(String(run._id));
  expect(await Run.findById(run._id).lean()).toMatchObject({ status: 'FAILED', errorCode: 'WORKER_INTERRUPTED' });
  expect(adapter.generateContent).toHaveBeenCalledTimes(1);
});
