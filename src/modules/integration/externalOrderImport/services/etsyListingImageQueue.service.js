const crypto = require('crypto');
const { createQueue } = require('../../../../config/queue');
const config = require('../../../../config');
const logger = require('../../../../shared/utils/logger');

const QUEUE_NAME = 'etsy-listing-images';
let queue;
function getQueue() {
  if (!queue) {
    queue = createQueue(QUEUE_NAME, { connection: { ...config.redis, enableOfflineQueue: false, maxRetriesPerRequest: 1 } });
    queue.on('error', () => logger.warn('etsy_listing_image_queue_unavailable'));
  }
  return queue;
}

async function enqueueListingImages(dto, importResult) {
  if (dto.salesChannelCode !== 'ETSY') return;
  for (const result of importResult.itemResults || []) {
    const item = (dto.items || []).find((entry) => String(entry.externalItemId) === String(result.externalItemId));
    const sourceUrl = item?.externalData?.etsy?.listingImageUrl;
    if (!sourceUrl) continue;
    try {
      if (!config.redis.enabled) throw new Error('Redis disabled');
      const payload = { shopId: String(dto.shopId), orderItemId: String(result.orderItemId), sourceUrl };
      const jobId = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const existing = await getQueue().getJob(jobId);
      if (existing) {
        if (await existing.getState() === 'failed') await existing.retry();
        continue;
      }
      await getQueue().add('save-image', payload, {
        jobId, attempts: 3, backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
      });
    } catch (_) {
      // Image failure never changes order import/readiness; reimport can enqueue again.
      logger.warn('etsy_listing_image_enqueue_failed', { orderItemId: result.orderItemId });
    }
  }
}

module.exports = { QUEUE_NAME, enqueueListingImages };
