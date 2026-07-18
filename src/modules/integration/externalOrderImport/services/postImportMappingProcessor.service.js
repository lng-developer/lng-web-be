const { randomUUID } = require('crypto');
const mappingPublic = require('../../../mapping/public');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const issueRepository = require('../repositories/externalOrderImportIssue.repository');
const { externalOrderPostImportStatuses } = require('../constants/externalOrderImportStatuses');
const { externalOrderImportSources } = require('../constants/externalOrderImportSources');
const {
  externalOrderImportIssueSeverities,
  externalOrderImportIssueTypes,
} = require('../constants/externalOrderImportIssueTypes');

const LEASE_MS = 5 * 60 * 1000;

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function getPayloadRawRecordIds(payload) {
  return (payload.rawRecordIds && payload.rawRecordIds.length ? payload.rawRecordIds : [payload.rawRecordId])
    .filter(Boolean);
}

async function updatePayloadRawRecords(payload, leaseToken, patch) {
  await Promise.all(getPayloadRawRecordIds(payload).map((rawRecordId) => (
    rawRecordRepository.updatePostImportResultForLease(rawRecordId, leaseToken, patch)
  )));
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
    details: { orderId: payload.orderId, orderItemId: payload.orderItemId },
  });
}

async function processPostImportMapping(payload = {}, { isFinalAttempt = false } = {}) {
  const leaseToken = randomUUID();
  const claimed = await rawRecordRepository.claimPostImportRecords(
    getPayloadRawRecordIds(payload),
    leaseToken,
    { leaseMs: LEASE_MS },
  );
  if (!claimed) return { skipped: true };

  try {
    const result = await mappingPublic.recheckFulfillmentPlan(payload.orderItemId, {}, {
      system: true,
      source: 'EXTERNAL_ORDER_IMPORT',
    });
    await updatePayloadRawRecords(payload, leaseToken, {
      postImportStatus: externalOrderPostImportStatuses.COMPLETED,
      postImportFinishedAt: new Date(),
      postImportErrorCode: null,
      postImportErrorMessage: null,
    });
    return { skipped: false, result };
  } catch (error) {
    await updatePayloadRawRecords(payload, leaseToken, {
      postImportStatus: externalOrderPostImportStatuses.FAILED,
      postImportFinishedAt: new Date(),
      postImportErrorCode: error.code || externalOrderImportIssueTypes.MAPPING_RECHECK_FAILED,
      postImportErrorMessage: getErrorMessage(error),
    });
    if (isFinalAttempt) await createFailureIssue(payload, error);
    throw error;
  }
}

module.exports = {
  LEASE_MS,
  processPostImportMapping,
};
