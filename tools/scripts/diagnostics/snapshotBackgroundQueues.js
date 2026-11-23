const { createQueue, createQueueConnection } = require('../../../src/config/queue');

const QUEUES = [
  'external-order-import', 'external-order-customization-assets', 'etsy-listing-images',
  'external-order-post-import', 'mapping-fulfillment-side-effects',
  'finance-snapshot-recalculation', 'finance-import', 'order-recheck-jobs',
];
const WAITING_STATES = ['waiting', 'paused', 'prioritized'];
const SAMPLE_LIMIT = 100;

async function snapshotBackgroundQueues(now = Date.now()) {
  const queues = [];
  for (const name of QUEUES) {
    const queue = createQueue(name, {
      skipMetasUpdate: true,
      connection: { ...createQueueConnection(), maxRetriesPerRequest: 1,
        enableOfflineQueue: false, connectTimeout: 5000, retryStrategy: () => null },
    });
    // Redis errors are propagated by the awaited read; do not print credentials from error events.
    queue.on('error', () => {});
    try {
      const client = await queue.client;
      const counts = {};
      // BullMQ getters may remove legacy wait markers; use only Redis read commands here.
      for (const state of [...WAITING_STATES, 'active', 'delayed', 'failed', 'completed', 'waiting-children']) {
        const key = queue.toKey(state === 'waiting' ? 'wait' : state);
        const list = ['waiting', 'paused', 'active'].includes(state);
        counts[state] = await client[list ? 'llen' : 'zcard'](key);
        if (state === 'waiting' || state === 'paused') {
          const tail = await client.lindex(key, -1);
          if (tail?.startsWith('0:')) counts[state] = Math.max(0, counts[state] - 1);
        }
      }
      const samples = await Promise.all(WAITING_STATES.map((state) => {
        const key = queue.toKey(state === 'waiting' ? 'wait' : state);
        return state === 'prioritized' ? client.zrange(key, 0, SAMPLE_LIMIT - 1)
          : client.lrange(key, -SAMPLE_LIMIT, -1);
      }));
      const ids = [...new Set(samples.flat().filter((id) => !id.startsWith('0:')))];
      const timestamps = (await Promise.all(ids.map((id) => client.hget(queue.toKey(id), 'timestamp'))))
        .filter((value) => value !== null).map(Number).filter(Number.isFinite);
      queues.push({
        queue: name, counts, sampleLimitPerState: SAMPLE_LIMIT,
        sampledWaitingJobs: timestamps.length,
        // shortcut: bounded samples cannot establish the oldest timestamp across a large retry backlog.
        oldestSampledWaitingJobAgeMs: timestamps.length ? Math.max(0, now - Math.min(...timestamps)) : null,
      });
    } finally {
      await queue.close();
    }
  }
  return { capturedAt: new Date(now).toISOString(), queues };
}

if (require.main === module) {
  snapshotBackgroundQueues().then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }).catch(() => {
    process.stderr.write('Queue snapshot failed; check Redis connectivity and configuration.\n');
    process.exitCode = 1;
  });
}

module.exports = { snapshotBackgroundQueues, QUEUES };
