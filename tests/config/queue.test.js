jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name, opts) => ({ name, opts })),
  Worker: jest.fn().mockImplementation((name, processor, opts) => Object.assign(
    new (require('events').EventEmitter)(), { name, processor, opts },
  )),
  QueueEvents: jest.fn().mockImplementation((name, opts) => ({ name, opts })),
}));

const { Queue } = require('bullmq');
jest.mock('../../src/shared/utils/logger', () => ({ info: jest.fn(), warn: jest.fn() }));
const logger = require('../../src/shared/utils/logger');
const { createQueue, createWorker, connectQueueProducers } = require('../../src/config/queue');

describe('queue config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('applies default job retention options to prevent Redis memory leak', () => {
    createQueue('test-queue');

    expect(Queue).toHaveBeenCalledWith('test-queue', expect.objectContaining({
      defaultJobOptions: expect.objectContaining({
        removeOnComplete: 100,
        removeOnFail: 500,
      }),
    }));
  });

  test('allows overriding default job options when specified', () => {
    createQueue('custom-queue', {
      defaultJobOptions: {
        removeOnComplete: 50,
      },
    });

    expect(Queue).toHaveBeenCalledWith('custom-queue', expect.objectContaining({
      defaultJobOptions: expect.objectContaining({
        removeOnComplete: 50,
        removeOnFail: 500,
      }),
    }));
  });

  test('split producers use a connected fail-fast client independently of workers', async () => {
    const client = { on: jest.fn(), connect: jest.fn(), disconnect: jest.fn() };
    const redis = { duplicate: jest.fn().mockReturnValue(client) };
    const close = await connectQueueProducers(redis);
    try {
      expect(redis.duplicate).toHaveBeenCalledWith(expect.objectContaining({
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      }));
      expect(client.connect).toHaveBeenCalledTimes(1);
      createQueue('split-producer');
      expect(Queue).toHaveBeenCalledWith('split-producer', expect.objectContaining({
        connection: client,
        skipWaitingForReady: true,
      }));
      const worker = createWorker('split-worker', jest.fn());
      expect(worker.opts.connection).not.toBe(client);
      expect(worker.opts.connection.maxRetriesPerRequest).toBeNull();
    } finally {
      close();
    }
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  test('logs a bounded completion record without job payload or result', async () => {
    const processor = jest.fn().mockResolvedValue({ secret: 'private result' });
    const worker = createWorker('finance', processor, { concurrency: 3 });
    const job = { id: 'job-1', timestamp: 1000, processedOn: 2000, finishedOn: 2300,
      attemptsMade: 1, data: { secret: 'private payload' } };
    const result = await worker.processor(job);
    worker.emit('completed', job, result);
    expect(worker.opts.concurrency).toBe(3);
    expect(result).toEqual({ secret: 'private result' });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('background_job_finished', {
      queue: 'finance', jobId: 'job-1', outcome: 'completed', attempt: 1,
      durationMs: 300, jobAgeAtStartMs: 1000,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('private');
  });

  test('does not swallow processor errors or change retry options', async () => {
    const failure = new Error('secret vendor response');
    const processor = jest.fn().mockRejectedValue(failure);
    const worker = createWorker('tracking', processor, { concurrency: 1 });
    const job = { id: 'job-2', timestamp: 1000, processedOn: 2000,
      attemptsMade: 2, opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } };
    await expect(worker.processor(job)).rejects.toBe(failure);
    worker.emit('failed', job, failure);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('background_job_finished', expect.objectContaining({
      queue: 'tracking', outcome: 'failed', attempt: 2, durationMs: expect.any(Number),
    }));
    expect(job.opts).toEqual({ attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });

  test('handles a missing failed job without a negative or invented duration', () => {
    createWorker('test', jest.fn()).emit('failed', undefined, new Error('private'));
    expect(logger.warn).toHaveBeenCalledWith('background_job_finished', expect.objectContaining({
      jobId: null, durationMs: null, jobAgeAtStartMs: null,
    }));
  });
});
