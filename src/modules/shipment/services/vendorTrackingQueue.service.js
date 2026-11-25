const { createQueue } = require('../../../config/queue');
const { getRedisClient } = require('../../../config/redis');
const logger = require('../../../shared/utils/logger');
const submissions = require('../../vendorSubmission/public');
const polls = require('../repositories/vendorTrackingPoll.repository');
const { SUPPORTED_TRACKING_PROVIDERS } = require('../constants/shipment.constants');
const QUEUE_NAME = 'vendor-tracking';
const queues = new Map();
function providerQueueName(provider) {
  if (!SUPPORTED_TRACKING_PROVIDERS.includes(provider)) throw new Error('Unsupported tracking provider');
  return QUEUE_NAME + '-' + provider.toLowerCase();
}
async function enqueueTrackingCheck({ vendorSubmissionId, provider }) {
  const name = provider ? providerQueueName(provider) : QUEUE_NAME;
  if (!queues.has(name)) queues.set(name, createQueue(name));
  const jobId = 'tracking-' + vendorSubmissionId;
  await queues.get(name).add('check', { vendorSubmissionId: String(vendorSubmissionId) }, {
    jobId, removeOnComplete: true, removeOnFail: true,
  });
  return { queued: true, jobId };
}
async function discoverAndEnqueue(limit) {
  const redis = getRedisClient();
  const system = { system: true, source: 'VENDOR_TRACKING_RECHECK_SCHEDULER' };
  let queued = 0;
  const failedProviders = [];
  for (const provider of SUPPORTED_TRACKING_PROVIDERS) {
    try {
      const key = 'tracking:discovery:' + provider;
      const afterId = await redis.get(key);
      const page = await submissions.listTrackingDiscoveryPage({ provider, limit, afterId }, system);
      await polls.discover(page.ids, new Date(), provider);
      if (page.afterId) await redis.set(key, page.afterId);
      else if (afterId) await redis.del(key);
      const due = await polls.due(limit, new Date(), provider);
      for (const row of due) {
        await enqueueTrackingCheck({ vendorSubmissionId: row._id, provider });
        queued += 1;
      }
    } catch (error) {
      failedProviders.push(provider);
      logger.warn('vendor_tracking_dispatch_failed', { provider, errorCode: error.code });
    }
  }
  // Drain durable records created before provider routing was introduced.
  for (const row of await polls.due(limit, new Date(), null)) {
    await enqueueTrackingCheck({ vendorSubmissionId: row._id });
    queued += 1;
  }
  return { queued, failedProviders, checked: 0, applied: 0, skipped: 0, failed: 0 };
}
async function closeVendorTrackingQueue() {
  await Promise.all([...queues.values()].map(queue => queue.close()));
  queues.clear();
}
module.exports = { QUEUE_NAME, providerQueueName, discoverAndEnqueue, enqueueTrackingCheck, closeVendorTrackingQueue };
