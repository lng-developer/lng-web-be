const { createQueue } = require('../../../../config/queue');
const config = require('../../../../config');
const logger = require('../../../../shared/utils/logger');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const {
  externalOrderPostImportStatuses,
} = require('../constants/externalOrderImportStatuses');

const QUEUE_NAME = 'external-order-post-import';
const POST_IMPORT_QUEUE_UNAVAILABLE = 'POST_IMPORT_QUEUE_UNAVAILABLE';

let queue;

function getQueue() {
  if (!queue) queue = createQueue(QUEUE_NAME);
  return queue;
}

function buildPostImportJobId({ importJobId, orderItemId }) {
  return `post-import:${importJobId}:${orderItemId}`;
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function getPayloadRawRecordIds(payload) {
  return (payload.rawRecordIds && payload.rawRecordIds.length ? payload.rawRecordIds : [payload.rawRecordId])
    .filter(Boolean);
}

async function markQueueFailure(payload, error) {
  await Promise.all(getPayloadRawRecordIds(payload).map((rawRecordId) => rawRecordRepository.updatePostImportResult(rawRecordId, {
    postImportStatus: externalOrderPostImportStatuses.FAILED,
    postImportFinishedAt: new Date(),
    postImportErrorCode: POST_IMPORT_QUEUE_UNAVAILABLE,
    postImportErrorMessage: getErrorMessage(error),
  })));
}

async function enqueuePostImportMappingJob(payload, options = {}) {
  const rawRecordIds = getPayloadRawRecordIds(payload);
  if (!payload.importJobId || !payload.orderItemId || rawRecordIds.length === 0) {
    const errorMessage = 'Post-import queue payload requires importJobId, orderItemId, and rawRecordId';
    return {
      queued: false,
      errorCode: POST_IMPORT_QUEUE_UNAVAILABLE,
      errorMessage,
    };
  }

  try {
    if (!config.redis.enabled) {
      throw new Error('Redis queue is disabled');
    }

    const jobId = options.force
      ? `${buildPostImportJobId(payload)}-${Date.now()}`
      : buildPostImportJobId(payload);
    await Promise.all(rawRecordIds.map((rawRecordId) => (
      rawRecordRepository.updatePostImportResult(rawRecordId, {
        postImportStatus: externalOrderPostImportStatuses.QUEUED,
        postImportQueuedAt: new Date(),
        postImportStartedAt: null,
        postImportFinishedAt: null,
        postImportErrorCode: null,
        postImportErrorMessage: null,
        postImportLeaseToken: null,
        postImportLeaseExpiresAt: null,
      })
    )));

    await getQueue().add('mapping-recheck', payload, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnComplete: 1000,
      removeOnFail: false,
    });

    return { queued: true, jobId };
  } catch (error) {
    await markQueueFailure(payload, error);
    logger.warn('external_order_post_import_queue_unavailable', {
      importJobId: payload.importJobId,
      rawRecordId: payload.rawRecordId,
      orderItemId: payload.orderItemId,
      error,
    });
    return {
      queued: false,
      errorCode: POST_IMPORT_QUEUE_UNAVAILABLE,
      errorMessage: getErrorMessage(error),
    };
  }
}

function resetPostImportQueueForTest() {
  queue = null;
}

module.exports = {
  QUEUE_NAME,
  POST_IMPORT_QUEUE_UNAVAILABLE,
  buildPostImportJobId,
  enqueuePostImportMappingJob,
  resetPostImportQueueForTest,
};
