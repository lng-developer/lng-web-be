const { createWorker } = require('../../../../config/queue');
const order = require('../../../order/public');
const { QUEUE_NAME } = require('../services/etsyListingImageQueue.service');

function startEtsyListingImageWorker() {
  return createWorker(QUEUE_NAME, (job) => order.processListingImage(job.data), { concurrency: 2 });
}

module.exports = { startEtsyListingImageWorker };
