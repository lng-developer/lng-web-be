jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name, opts) => ({ name, opts })),
  Worker: jest.fn().mockImplementation((name, processor, opts) => ({ name, processor, opts })),
  QueueEvents: jest.fn().mockImplementation((name, opts) => ({ name, opts })),
}));

const { Queue } = require('bullmq');
const { createQueue, DEFAULT_JOB_OPTIONS } = require('../../src/config/queue');

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
});
