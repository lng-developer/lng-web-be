const logger = require('../../../../shared/utils/logger');
const errorCodes = require('../../../../shared/constants/errorCodes');
const orderPublic = require('../../../order/public');
const catalogPublic = require('../../../catalog/public');
const customizationPublic = require('../../../customization/public');
const rawRecordRepository = require('../repositories/externalOrderRawRecord.repository');
const issueRepository = require('../repositories/externalOrderImportIssue.repository');
const postImportMappingQueue = require('./postImportMappingQueue.service');
const { externalOrderImportSources } = require('../constants/externalOrderImportSources');
const {
  externalOrderImportIssueSeverities,
  externalOrderImportIssueTypes,
} = require('../constants/externalOrderImportIssueTypes');

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function getPayloadRawRecordIds(payload) {
  return (payload.rawRecordIds && payload.rawRecordIds.length ? payload.rawRecordIds : [payload.rawRecordId])
    .filter(Boolean);
}

function isScientificNotation(value) {
  return /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(String(value || '').trim());
}

function isIntegerString(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function isInvalidStatusTransition(error) {
  return error && error.code === errorCodes.CONFLICT_ERROR
    && /Invalid order item status transition/i.test(error.message || '');
}

function getCustomerInputs(processResult) {
  return processResult
    && processResult.payload
    && processResult.payload.parsedData
    && processResult.payload.parsedData.amazonCustomization
    && processResult.payload.parsedData.amazonCustomization.customerInputs;
}

function getCustomizationMismatch(payload, processResult) {
  const customerInputs = getCustomerInputs(processResult);
  if (!customerInputs) return null;

  const mismatches = [];
  if (customerInputs.orderId && String(customerInputs.orderId) !== String(payload.externalOrderId)) {
    mismatches.push({ field: 'orderId', expected: String(payload.externalOrderId), actual: String(customerInputs.orderId) });
  }

  if (customerInputs.orderItemId && String(customerInputs.orderItemId) !== String(payload.externalItemId)) {
    if (
      customerInputs.orderId
      && String(customerInputs.orderId) === String(payload.externalOrderId)
      && isScientificNotation(payload.externalItemId)
      && isIntegerString(customerInputs.orderItemId)
    ) {
      return { canonicalExternalItemId: String(customerInputs.orderItemId) };
    }

    mismatches.push({
      field: 'orderItemId',
      expected: String(payload.externalItemId),
      actual: String(customerInputs.orderItemId),
    });
  }

  if (mismatches.length === 0) return null;

  return {
    message: `Customization JSON mismatch: ${mismatches.map((entry) => `${entry.field} expected ${entry.expected} got ${entry.actual}`).join('; ')}`,
    details: { payloadId: processResult.payloadId || null, mismatches },
  };
}

function getCustomizationAsin(processResult) {
  const asin = getCustomerInputs(processResult) && getCustomerInputs(processResult).asin;
  return asin ? String(asin).trim() : '';
}

async function createFailureIssue(payload, error) {
  await issueRepository.create({
    source: externalOrderImportSources.MANUAL_EXCEL,
    severity: externalOrderImportIssueSeverities.ERROR,
    importJobId: payload.importJobId,
    rawRecordId: payload.rawRecordId,
    externalOrderId: payload.externalOrderId,
    externalItemId: payload.externalItemId,
    issueType: externalOrderImportIssueTypes.CUSTOMIZATION_CREATE_FAILED,
    errorCode: error.code || externalOrderImportIssueTypes.CUSTOMIZATION_CREATE_FAILED,
    errorMessage: getErrorMessage(error),
    details: { orderId: payload.orderId, orderItemId: payload.orderItemId },
  });
}

async function updatePayloadRawRecords(payload, patch) {
  await Promise.all(getPayloadRawRecordIds(payload).map((rawRecordId) => (
    rawRecordRepository.updatePostImportResult(rawRecordId, patch)
  )));
}

async function handleExtractedCustomization(payload, extractResult) {
  const customizationAsin = getCustomizationAsin(extractResult);
  if (customizationAsin && !payload.asin && typeof orderPublic.updateItemAsin === 'function') {
    await orderPublic.updateItemAsin(payload.orderItemId, customizationAsin);
    payload.asin = customizationAsin;
  }

  const mismatch = getCustomizationMismatch(payload, extractResult);
  if (!mismatch) return;

  if (mismatch.canonicalExternalItemId) {
    await orderPublic.updateItemExternalItemId(payload.orderItemId, mismatch.canonicalExternalItemId);
    payload.externalItemId = mismatch.canonicalExternalItemId;
    return;
  }

  if (mismatch.details.payloadId) {
    await customizationPublic.markNeedsReview(mismatch.details.payloadId, mismatch.message);
  }
  await issueRepository.create({
    source: externalOrderImportSources.MANUAL_EXCEL,
    severity: externalOrderImportIssueSeverities.ERROR,
    importJobId: payload.importJobId,
    rawRecordId: payload.rawRecordId,
    externalOrderId: payload.externalOrderId,
    externalItemId: payload.externalItemId,
    issueType: externalOrderImportIssueTypes.CUSTOMIZATION_MISMATCH,
    errorCode: externalOrderImportIssueTypes.CUSTOMIZATION_MISMATCH,
    errorMessage: mismatch.message,
    details: mismatch.details,
  });
}

async function syncListingPreviewImage(orderItemId, extractResult) {
  const productImageUrl = getCustomerInputs(extractResult)?.listingPreviewImageUrl;
  if (!productImageUrl) return;

  const item = await orderPublic.findItemById(orderItemId);
  if (!item?.shopId || !item.salesChannelCode || !item.marketplaceCode || !item.sku || !item.title) return;

  const listing = await catalogPublic.findOrCreateDraftListingForOrderItem({
    shopId: item.shopId,
    salesChannelCode: item.salesChannelCode,
    marketplaceCode: item.marketplaceCode,
    asin: item.asin,
    sku: item.sku,
    title: item.title,
    currency: item.price?.currency || item.currency,
    productImageUrl,
  }, { system: true, source: 'AMAZON_CUSTOMIZATION_PREVIEW' });
  const listingId = listing?._id || listing?.id;
  if (!listingId) return;

  if (String(item.listingId || '') !== String(listingId)) {
    await orderPublic.updateItemListingId(orderItemId, listingId);
  }
  await orderPublic.syncOrderWorkbenchListingImage(listingId, listing.productImageUrl || productImageUrl);
}

async function processCustomizationAssets(payload = {}, { isFinalAttempt = false } = {}) {
  try {
    const parsed = await customizationPublic.parseForOrderItem(payload.orderItemId);
    if (parsed?.status === 'PARSED') {
      try {
        await orderPublic.transitionItemStatus(payload.orderItemId, 'CUSTOMIZATION_PARSED', {
          system: true,
          source: 'CUSTOMIZATION_ASSET_WORKER',
        });
      } catch (error) {
        if (!isInvalidStatusTransition(error)) throw error;
        logger.warn('customization_asset_status_transition_skipped', {
          orderItemId: payload.orderItemId,
          error,
        });
      }
    }

    const downloadResult = await customizationPublic.downloadAssetsForOrderItem(payload.orderItemId, {
      retryFailed: false,
      maxBytes: 10 * 1024 * 1024,
      timeoutMs: 15000,
      idleTimeoutMs: 10000,
      maxRedirects: 3,
    });

    if ((downloadResult.downloadedCount || 0) > 0) {
      await customizationPublic.inspectDownloadedZipForOrderItem(payload.orderItemId, {
        maxEntries: 50,
        maxTotalUncompressedBytes: 50 * 1024 * 1024,
        maxSingleEntryUncompressedBytes: 20 * 1024 * 1024,
      });
      const extractResult = await customizationPublic.extractZipImagesForOrderItem(payload.orderItemId, {
        maxImages: 10,
        maxSingleImageBytes: 10 * 1024 * 1024,
        maxTotalImageBytes: 50 * 1024 * 1024,
      });
      await handleExtractedCustomization(payload, extractResult);
      await syncListingPreviewImage(payload.orderItemId, extractResult);
    }

    await postImportMappingQueue.enqueuePostImportMappingJob(payload);
    return { skipped: false, downloadedCount: downloadResult.downloadedCount || 0 };
  } catch (error) {
    await updatePayloadRawRecords(payload, {
      postImportErrorCode: error.code || externalOrderImportIssueTypes.CUSTOMIZATION_CREATE_FAILED,
      postImportErrorMessage: getErrorMessage(error),
    });
    if (isFinalAttempt) await createFailureIssue(payload, error);
    throw error;
  }
}

module.exports = { processCustomizationAssets };
