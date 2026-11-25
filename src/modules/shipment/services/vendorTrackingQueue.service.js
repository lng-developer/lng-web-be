const { createQueue } = require('../../../config/queue');
const { getRedisClient } = require('../../../config/redis');
const submissions = require('../../vendorSubmission/public');
const polls = require('../repositories/vendorTrackingPoll.repository');
const { SUPPORTED_TRACKING_PROVIDERS } = require('../constants/shipment.constants');

const QUEUE_NAME = 'vendor-tracking';
let queue;

async function enqueueTrackingCheck({ vendorSubmissionId }) {
  queue ||= createQueue(QUEUE_NAME);
  const jobId = `tracking-${vendorSubmissionId}`;
  await queue.add('check', { vendorSubmissionId: String(vendorSubmissionId) }, {
    jobId, removeOnComplete: true, removeOnFail: true,
  });
  return { queued: true, jobId };
}

async function discoverAndEnqueue(limit) {
  const redis = getRedisClient();
  const system = { system: true, source: 'VENDOR_TRACKING_RECHECK_SCHEDULER' };
  for (const provider of SUPPORTED_TRACKING_PROVIDERS) {
    const key = `tracking:discovery:${provider}`;
    const afterId = await redis.get(key);
    const page = await submissions.listTrackingDiscoveryPage({ provider, limit, afterId }, system);
    await polls.discover(page.ids);
    if (page.afterId) await redis.set(key, page.afterId);
    else if (afterId) await redis.del(key);
  }
  const due = await polls.due(limit * SUPPORTED_TRACKING_PROVIDERS.length);
  await Promise.all(due.map(row => enqueueTrackingCheck({ vendorSubmissionId: row._id })));
  return { queued: due.length, checked: 0, applied: 0, skipped: 0, failed: 0 };
}

async function closeVendorTrackingQueue() {
  if (queue) await queue.close();
  queue = undefined;
}
module.exports = { QUEUE_NAME, discoverAndEnqueue, enqueueTrackingCheck, closeVendorTrackingQueue };
