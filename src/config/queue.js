const { Queue, Worker, QueueEvents } = require('bullmq');
const config = require('./index');
const logger = require('../shared/utils/logger');

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: 100,
  removeOnFail: 500,
};
let producerConnection;

async function connectQueueProducers(redis) {
  const client = redis.duplicate({
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
  });
  client.on('error', (error) => logger.warn('background_queue_producer_error', { errorCode: error.code }));
  try {
    await client.connect();
  } catch (error) {
    client.disconnect();
    throw error;
  }
  producerConnection = client;
  return () => {
    producerConnection = undefined;
    client.disconnect();
  };
}

function createQueueConnection() {
  return {
    ...config.redis,
    maxRetriesPerRequest: null,
  };
}

function createQueue(name, options = {}) {
  const { defaultJobOptions, ...restOptions } = options;
  const useProducerConnection = producerConnection && !restOptions.connection;
  return new Queue(name, {
    connection: useProducerConnection ? producerConnection : createQueueConnection(),
    // The runtime connects this client first and workers verify the Redis version.
    ...(useProducerConnection ? { skipWaitingForReady: true, skipVersionCheck: true } : {}),
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      ...defaultJobOptions,
    },
    ...restOptions,
  });
}

function createWorker(name, processor, options = {}) {
  const worker = new Worker(name, processor, {
    connection: createQueueConnection(),
    ...options,
  });
  function logFinished(job, outcome) {
    const fields = {
      queue: name,
      jobId: job?.id ?? null,
      outcome,
      attempt: job?.attemptsMade ?? null,
      durationMs: Number.isFinite(job?.processedOn)
        ? Math.max(0, (job.finishedOn ?? Date.now()) - job.processedOn) : null,
      jobAgeAtStartMs: Number.isFinite(job?.processedOn) && Number.isFinite(job?.timestamp)
        ? Math.max(0, job.processedOn - job.timestamp) : null,
    };
    logger[outcome === 'completed' ? 'info' : 'warn']('background_job_finished', fields);
  }
  worker.on('completed', (job) => logFinished(job, 'completed'));
  worker.on('failed', (job) => logFinished(job, 'failed'));
  return worker;
}

function createQueueEvents(name, options = {}) {
  return new QueueEvents(name, {
    connection: createQueueConnection(),
    ...options,
  });
}

module.exports = {
  createQueue,
  createWorker,
  createQueueEvents,
  createQueueConnection,
  connectQueueProducers,
  DEFAULT_JOB_OPTIONS,
};
