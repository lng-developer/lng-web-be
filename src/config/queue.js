const { Queue, Worker, QueueEvents } = require('bullmq');
const config = require('./index');

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: 100,
  removeOnFail: 500,
};

function createQueueConnection() {
  return {
    ...config.redis,
    maxRetriesPerRequest: null,
  };
}

function createQueue(name, options = {}) {
  const { defaultJobOptions, ...restOptions } = options;
  return new Queue(name, {
    connection: createQueueConnection(),
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      ...defaultJobOptions,
    },
    ...restOptions,
  });
}

function createWorker(name, processor, options = {}) {
  return new Worker(name, processor, {
    connection: createQueueConnection(),
    ...options,
  });
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
  DEFAULT_JOB_OPTIONS,
};
