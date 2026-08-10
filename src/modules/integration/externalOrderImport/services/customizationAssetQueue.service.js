const { createQueue } = require('../../../../config/queue');
const config = require('../../../../config');
const logger = require('../../../../shared/utils/logger');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const {
  externalOrderPostImportStatuses,
} = require('../constants/externalOrderImportStatuses');

const QUEUE_NAME = 'external-order-customization-assets';
const CUSTOMIZATION_ASSET_QUEUE_UNAVAILABLE = 'CUSTOMIZATION_ASSET_QUEUE_UNAVAILABLE';

let queue;

function getQueue() {
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

function getPayloadRawRecordIds(payload) {
  return (payload.rawRecordIds && payload.rawRecordIds.length ? payload.rawRecordIds : [payload.rawRecordId])
    .filter(Boolean);
}

async function markQueueFailure(payload, error) {
  await Promise.all(getPayloadRawRecordIds(payload).map((rawRecordId) => rawRecordRepository.updatePostImportResult(rawRecordId, {
    postImportStatus: externalOrderPostImportStatuses.FAILED,
    postImportFinishedAt: new Date(),
    postImportErrorCode: CUSTOMIZATION_ASSET_QUEUE_UNAVAILABLE,
    postImportErrorMessage: error?.message || String(error),
  })));
}

async function enqueueCustomizationAssetJob(payload = {}) {
  const rawRecordIds = getPayloadRawRecordIds(payload);
  if (!payload.importJobId || !payload.orderItemId || rawRecordIds.length === 0) {
    return {
      queued: false,
      errorCode: CUSTOMIZATION_ASSET_QUEUE_UNAVAILABLE,
      errorMessage: 'Customization asset queue payload requires importJobId, orderItemId, and rawRecordId',
    };
  }

  try {
    if (!config.redis.enabled) throw new Error('Redis queue is disabled');
    await getQueue().add('process-customization-assets', payload, {
      jobId: `customization-assets:${payload.importJobId}:${payload.orderItemId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnComplete: 1000,
      removeOnFail: false,
    });
    return { queued: true };
  } catch (error) {
    await markQueueFailure(payload, error);
    logger.warn('customization_asset_queue_unavailable', {
      importJobId: payload.importJobId,
      orderItemId: payload.orderItemId,
      error,
    });
    return {
      queued: false,
      errorCode: CUSTOMIZATION_ASSET_QUEUE_UNAVAILABLE,
      errorMessage: error?.message || String(error),
    };
  }
}

function resetCustomizationAssetQueueForTest() {
  queue = null;
}

module.exports = {
  QUEUE_NAME,
  CUSTOMIZATION_ASSET_QUEUE_UNAVAILABLE,
  enqueueCustomizationAssetJob,
  resetCustomizationAssetQueueForTest,
};
