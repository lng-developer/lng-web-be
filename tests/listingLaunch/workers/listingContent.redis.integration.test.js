// Opt in ONLY with a dedicated test Redis URL. Never fall back to application Redis.
const testRedisUrl = process.env.LISTING_CONTENT_TEST_REDIS_URL;
const describeRedis = testRedisUrl ? describe : describe.skip;
jest.mock('../../../src/config', () => ({ redis: { enabled: true }, listingContent: { enabled: true, model: 'test-model', apiKey: 'test-key' } }));
jest.mock('../../../src/modules/listingLaunch/adapters/openaiContent.adapter', () => ({ generateContent: jest.fn() }));
jest.mock('../../../src/config/queue', () => {
  const { Queue, Worker } = require('bullmq');
  const { randomUUID } = require('crypto');
  const prefix = `listing-content-test-${randomUUID()}`;
  const url = process.env.LISTING_CONTENT_TEST_REDIS_URL ? new URL(process.env.LISTING_CONTENT_TEST_REDIS_URL) : null;
  if (url && !['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Test Redis URL must use redis: or rediss:');
  const connection = url ? { host: url.hostname, port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0), ...(url.protocol === 'rediss:' ? { tls: {} } : {}) } : null;
  const requireConnection = () => {
    if (!connection) throw new Error('Explicit LISTING_CONTENT_TEST_REDIS_URL is required');
    return { ...connection, maxRetriesPerRequest: null };
  };
  return {
    createQueueConnection: requireConnection,
    createQueue: (name, options) => new Queue(name, { ...options, prefix }),
    createWorker: (name, processor, options) => new Worker(name, processor, { ...options, connection: requireConnection(), prefix }),
  };
});

describeRedis('dedicated Redis delivery + real Mongo transactions', () => {
  const mongoose = require('mongoose');
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  const Launch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
  const Run = require('../../../src/modules/listingLaunch/models/listingContentRun.model');
  const Version = require('../../../src/modules/listingLaunch/models/listingContentVersion.model');
  const adapter = require('../../../src/modules/listingLaunch/adapters/openaiContent.adapter');
  const factory = require('../../../src/config/queue');
  const queue = require('../../../src/modules/listingLaunch/queues/listingContent.queue');
  const service = require('../../../src/modules/listingLaunch/services/listingContentGeneration.service');
  const worker = require('../../../src/modules/listingLaunch/workers/listingContent.worker');
  const { launchPayload, runPayload, content } = require('../helpers/contentFixtures');
  let mongo;
  const jobs = [];
  jest.setTimeout(30000);
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri(), { dbName: 'listing_content_redis_test' });
    await Promise.all([Launch.init(), Run.init(), Version.init()]);
    await queue.assertQueueReady();
  }, 60000);
  afterAll(async () => {
    await worker.stopListingContentWorker();
    // Remove only jobs this suite created in its random namespace.
    try { for (const id of jobs) { const job = await queue.getQueue().getJob(id); if (job) await job.remove(); } }
    finally { await queue.closeQueue(); await mongoose.disconnect(); if (mongo) await mongo.stop(); }
  }, 60000);
  beforeEach(() => { adapter.generateContent.mockReset().mockResolvedValue({ content }); });
  async function createRun() {
    const launch = await Launch.create(launchPayload());
    const run = await Run.create(runPayload(launch._id));
    jobs.push(String(run._id));
    return run;
  }
  async function waitForSuccess(run) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const current = await Run.findById(run._id).lean();
      if (current.status === 'SUCCEEDED') return current;
      if (current.status === 'FAILED') throw new Error(`Test generation failed: ${current.errorCode}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Test worker did not complete in 10 seconds');
  }
  test('startup recovers missing job; duplicate delivery still commits one version', async () => {
    const run = await createRun();
    worker.startListingContentWorker();
    await waitForSuccess(run);
    await Promise.all([service.processGeneration(String(run._id)), queue.enqueueGeneration(String(run._id))]);
    await worker.stopListingContentWorker();
    expect(adapter.generateContent).toHaveBeenCalledTimes(1);
    expect(await Version.countDocuments({ runId: run._id })).toBe(1);
  });
  test('startup replaces terminal queue job for a still queued run', async () => {
    const run = await createRun();
    const terminalWorker = factory.createWorker(queue.queueName, async () => null, { concurrency: 1 });
    try {
      const completed = new Promise((resolve) => terminalWorker.once('completed', resolve));
      await queue.enqueueGeneration(String(run._id));
      await completed;
    } finally { await terminalWorker.close(); }
    expect(await Run.findById(run._id).lean()).toMatchObject({ status: 'QUEUED' });
    worker.startListingContentWorker();
    await waitForSuccess(run);
    await worker.stopListingContentWorker();
    expect(adapter.generateContent).toHaveBeenCalledTimes(1);
    expect(await Version.countDocuments({ runId: run._id })).toBe(1);
  });
});
