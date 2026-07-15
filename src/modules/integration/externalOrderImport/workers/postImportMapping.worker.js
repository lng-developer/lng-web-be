const { createWorker } = require('../../../../config/queue');
const mappingPublic = require('../../../mapping/public');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const issueRepository = require('../repositories/externalOrderImportIssue.repository');
const {
  externalOrderPostImportStatuses,
} = require('../constants/externalOrderImportStatuses');
const { externalOrderImportSources } = require('../constants/externalOrderImportSources');
const {
  externalOrderImportIssueSeverities,
  externalOrderImportIssueTypes,
} = require('../constants/externalOrderImportIssueTypes');
const { QUEUE_NAME } = require('../services/postImportMappingQueue.service');

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function getPayloadRawRecordIds(payload) {
  return (payload.rawRecordIds && payload.rawRecordIds.length ? payload.rawRecordIds : [payload.rawRecordId])
    .filter(Boolean);
}

async function updatePayloadRawRecords(payload, patch, options) {
  await Promise.all(getPayloadRawRecordIds(payload).map((rawRecordId) => (
    options
      ? rawRecordRepository.updatePostImportResult(rawRecordId, patch, options)
      : rawRecordRepository.updatePostImportResult(rawRecordId, patch)
  )));
}

function isFinalAttempt(job) {
  const attempts = job && job.opts && job.opts.attempts ? job.opts.attempts : 1;
  return ((job && job.attemptsMade) || 0) + 1 >= attempts;
}

async function createFailureIssue(payload, error) {
  await issueRepository.create({
    source: externalOrderImportSources.MANUAL_EXCEL,
    severity: externalOrderImportIssueSeverities.ERROR,
    importJobId: payload.importJobId,
    rawRecordId: payload.rawRecordId,
    externalOrderId: payload.externalOrderId,
    externalItemId: payload.externalItemId,
    issueType: externalOrderImportIssueTypes.MAPPING_RECHECK_FAILED,
    errorCode: error.code || externalOrderImportIssueTypes.MAPPING_RECHECK_FAILED,
    errorMessage: getErrorMessage(error),
    details: {
      orderId: payload.orderId,
      orderItemId: payload.orderItemId,
    },
  });
}

async function processPostImportMappingJob(job) {
  const payload = job.data || {};

  await updatePayloadRawRecords(payload, {
    postImportStatus: externalOrderPostImportStatuses.PROCESSING,
    postImportStartedAt: new Date(),
    postImportFinishedAt: null,
    postImportErrorCode: null,
    postImportErrorMessage: null,
  }, { incrementAttempts: true });

  try {
    await mappingPublic.recheckFulfillmentPlan(payload.orderItemId, {}, {
      system: true,
      source: 'EXTERNAL_ORDER_IMPORT',
    });

    await updatePayloadRawRecords(payload, {
      postImportStatus: externalOrderPostImportStatuses.COMPLETED,
      postImportFinishedAt: new Date(),
      postImportErrorCode: null,
      postImportErrorMessage: null,
    });
  } catch (error) {
    await updatePayloadRawRecords(payload, {
      postImportStatus: externalOrderPostImportStatuses.FAILED,
      postImportFinishedAt: new Date(),
      postImportErrorCode: error.code || externalOrderImportIssueTypes.MAPPING_RECHECK_FAILED,
      postImportErrorMessage: getErrorMessage(error),
    });

    if (isFinalAttempt(job)) {
      await createFailureIssue(payload, error);
    }
    throw error;
  }
}

function startPostImportMappingWorker() {
  return createWorker(QUEUE_NAME, processPostImportMappingJob, { concurrency: 3 });
}

module.exports = {
  processPostImportMappingJob,
  startPostImportMappingWorker,
};
