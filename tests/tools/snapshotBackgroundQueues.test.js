jest.mock('../../src/config/queue', () => ({
  createQueue: jest.fn(), createQueueConnection: () => ({}),
}));
const { createQueue } = require('../../src/config/queue');
const { snapshotBackgroundQueues, QUEUES } = require('../../tools/scripts/diagnostics/snapshotBackgroundQueues');

test('reads bounded samples, excludes payloads and closes every queue', async () => {
  const queues = [];
  createQueue.mockImplementation(() => {
    const client = { llen: jest.fn().mockResolvedValue(101), lindex: jest.fn().mockResolvedValue('0:marker'),
      zcard: jest.fn().mockResolvedValue(0), lrange: jest.fn().mockResolvedValue(['0:marker', 'job']),
      zrange: jest.fn().mockResolvedValue([]), hget: jest.fn().mockResolvedValue('1000') };
    const queue = { on: jest.fn(), close: jest.fn(),
      client: Promise.resolve(client), toKey: (key) => `test:${key}`,
    };
    queues.push(queue);
    return queue;
  });
  const report = await snapshotBackgroundQueues(5000);
  expect(report.queues).toHaveLength(QUEUES.length);
  expect(report.queues[0]).toMatchObject({ oldestSampledWaitingJobAgeMs: 4000, sampleLimitPerState: 100 });
  expect(report.queues[0].counts.waiting).toBe(100);
  expect(JSON.stringify(report)).not.toContain('private');
  expect(createQueue).toHaveBeenCalledWith(QUEUES[0], expect.objectContaining({ skipMetasUpdate: true }));
  for (const queue of queues) {
    expect(queue.close).toHaveBeenCalledTimes(1);
    const client = await queue.client;
    expect(client.lrange).toHaveBeenCalledWith('test:wait', -100, -1);
    expect(client.hget).not.toHaveBeenCalledWith('test:0:marker', 'timestamp');
  }
});

test('closes the connection and propagates read failures', async () => {
  const close = jest.fn();
  createQueue.mockReturnValue({ on: jest.fn(), close,
    toKey: (key) => key, client: Promise.resolve({ llen: jest.fn().mockRejectedValue(new Error('unavailable')) }),
  });
  await expect(snapshotBackgroundQueues()).rejects.toThrow('unavailable');
  expect(close).toHaveBeenCalledTimes(1);
});
