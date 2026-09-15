jest.mock('../../../src/config/queue', () => ({ createQueue: jest.fn(), createWorker: jest.fn(), createQueueConnection: () => ({ host: 'test-only', maxRetriesPerRequest: null }) }));
jest.mock('../../../src/config', () => ({ redis: { enabled: true } }));
jest.mock('../../../src/modules/listingLaunch/services/listingContentGeneration.service', () => ({ processGeneration: jest.fn(), recoverGenerationRuns: jest.fn() }));
const factory = require('../../../src/config/queue');
const service = require('../../../src/modules/listingLaunch/services/listingContentGeneration.service');
const config = require('../../../src/config');
const queue = require('../../../src/modules/listingLaunch/queues/listingContent.queue');
const { startListingContentWorker, stopListingContentWorker } = require('../../../src/modules/listingLaunch/workers/listingContent.worker');
let fakeQueue;
let fakeWorker;
beforeEach(() => {
  jest.resetAllMocks();
  config.redis.enabled = true;
  fakeQueue = { on: jest.fn(), waitUntilReady: jest.fn().mockResolvedValue({ ping: jest.fn().mockResolvedValue('PONG') }),
    getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({ id: 'run' }), close: jest.fn(), disconnect: jest.fn() };
  fakeWorker = { on: jest.fn(), close: jest.fn() };
  factory.createQueue.mockReturnValue(fakeQueue);
  factory.createWorker.mockReturnValue(fakeWorker);
});

test('disabled Redis rejects readiness without opening any connection', async () => {
  config.redis.enabled = false;
  await expect(queue.assertQueueReady()).rejects.toMatchObject({ statusCode: 503 });
  expect(factory.createQueue).not.toHaveBeenCalled();
});
afterEach(async () => { await stopListingContentWorker(); await queue.closeQueue(); jest.useRealTimers(); });

test('imports open no connections; enqueue is idempotent with runId-only payload and one attempt', async () => {
  expect(factory.createQueue).not.toHaveBeenCalled();
  expect(factory.createWorker).not.toHaveBeenCalled();
  await queue.enqueueGeneration('run');
  expect(fakeQueue.add).toHaveBeenCalledWith('generate', { runId: 'run' }, expect.objectContaining({ jobId: 'run', attempts: 1 }));
  fakeQueue.getJob.mockResolvedValueOnce({ getState: async () => 'active' });
  await queue.enqueueGeneration('run');
  expect(fakeQueue.add).toHaveBeenCalledTimes(1);
});

test.each(['completed', 'failed'])('recovery replaces %s queue job for queued Mongo row', async (state) => {
  const remove = jest.fn();
  fakeQueue.getJob.mockResolvedValueOnce({ getState: async () => state, remove });
  await queue.enqueueGeneration('run');
  expect(remove).toHaveBeenCalledTimes(1);
  expect(fakeQueue.add).toHaveBeenCalledWith('generate', { runId: 'run' }, expect.objectContaining({ jobId: 'run', attempts: 1 }));
});

test('readiness rejects within 3 seconds even when Redis ready promise never resolves', async () => {
  jest.useFakeTimers();
  fakeQueue.waitUntilReady.mockReturnValueOnce(new Promise(() => {}));
  const result = expect(queue.assertQueueReady()).rejects.toMatchObject({ statusCode: 503 });
  await jest.advanceTimersByTimeAsync(3000);
  await result;
  expect(jest.getTimerCount()).toBe(0);
});

test('dispatch rejects within 3 seconds when Redis fails after readiness', async () => {
  jest.useFakeTimers();
  fakeQueue.add.mockReturnValueOnce(new Promise(() => {}));
  const result = expect(queue.enqueueGeneration('run')).rejects.toMatchObject({ statusCode: 503 });
  await jest.advanceTimersByTimeAsync(3000);
  await result;
});

test('worker wires renewal-safe options and runs non-overlapping startup/30-second recovery', async () => {
  jest.useFakeTimers();
  startListingContentWorker();
  expect(factory.createWorker).toHaveBeenCalledWith('listing-launch-content', expect.any(Function), {
    concurrency: 2, lockDuration: 120000, stalledInterval: 60000,
  });
  expect(service.recoverGenerationRuns).toHaveBeenCalledTimes(1);
  const processor = factory.createWorker.mock.calls[0][1];
  await processor({ data: { runId: 'run' } });
  expect(service.processGeneration).toHaveBeenCalledWith('run');
  await jest.advanceTimersByTimeAsync(30000);
  expect(service.recoverGenerationRuns).toHaveBeenCalledTimes(2);
  await stopListingContentWorker();
  expect(fakeWorker.close).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(60000);
  expect(service.recoverGenerationRuns).toHaveBeenCalledTimes(2);
});
