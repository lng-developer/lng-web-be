const { Queue, Worker, QueueEvents } = require('bullmq');
const config = require('./index');

function createQueueConnection() {
  return {
    ...config.redis,
    maxRetriesPerRequest: null,
  };
}

function createQueue(name, options = {}) {
  return new Queue(name, {
    connection: createQueueConnection(),
    ...options,
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
};
