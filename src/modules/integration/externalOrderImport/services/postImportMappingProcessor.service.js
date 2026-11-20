const { randomUUID } = require("crypto");
const mappingPublic = require("../../../mapping/public");
const productionPublic = require("../../../production/public");
const listingImageSync = require("../../listingImageSync/public");
const logger = require("../../../../shared/utils/logger");
const rawRecordRepository = require("../repositories/externalOrderRawRecord.repository");
const issueRepository = require("../repositories/externalOrderImportIssue.repository");
const {
  externalOrderPostImportStatuses,
} = require("../constants/externalOrderImportStatuses");
const {
  externalOrderImportSources,
} = require("../constants/externalOrderImportSources");
const {
  externalOrderImportIssueSeverities,
  externalOrderImportIssueTypes,
} = require("../constants/externalOrderImportIssueTypes");

const LEASE_MS = 5 * 60 * 1000;

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function getPayloadRawRecordIds(payload) {
  return (
    payload.rawRecordIds && payload.rawRecordIds.length
      ? payload.rawRecordIds
      : [payload.rawRecordId]
  ).filter(Boolean);
}

async function updatePayloadRawRecords(payload, leaseToken, patch) {
  await Promise.all(
    getPayloadRawRecordIds(payload).map((rawRecordId) =>
      rawRecordRepository.updatePostImportResultForLease(
        rawRecordId,
        leaseToken,
        patch,
      ),
    ),
  );
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
    errorCode:
      error.code || externalOrderImportIssueTypes.MAPPING_RECHECK_FAILED,
    errorMessage: getErrorMessage(error),
    details: { orderId: payload.orderId, orderItemId: payload.orderItemId },
  });
}

async function enqueueImagesWhenImportJobIsReady(importJobId, shopId) {
  if (!importJobId || !shopId) return;

  try {
    const rawRecords = await rawRecordRepository.listAllByJob(importJobId, {
      importStatus: "IMPORTED",
    });
    if (!rawRecords.length || rawRecords.some((record) => ![
      externalOrderPostImportStatuses.COMPLETED,
      externalOrderPostImportStatuses.SKIPPED,
    ].includes(record.postImportStatus))) return;

    const asins = [...new Set(rawRecords
      .map((record) => String(record.asin || "").trim().toUpperCase())
      .filter(Boolean))];
    if (asins.length) {
      const BATCH_SIZE = 25;
      for (let i = 0; i < asins.length; i += BATCH_SIZE) {
        await listingImageSync.enqueueImportedOrderImages({
          shopId,
          asins: asins.slice(i, i + BATCH_SIZE),
        });
      }
    }
  } catch (error) {
    logger.warn("listing_image_sync_enqueue_failed", { importJobId, shopId, error });
  }
}

async function autoRequestPsdForFulfillmentPlan(result, payload) {
  if (result?.salesChannelCode !== "AMAZON") return;
  const listingId = result.listingId
    ? String(result.listingId)
    : (result.listing ? String(result.listing._id || result.listing.id || "") : null);
  const listingVariantId = result.listingVariantId ? String(result.listingVariantId) : null;
  if (!listingId) return;

  try {
    const designPublic = require("../../../design/public");
    if (typeof designPublic.createPsdTemplateTask !== "function") return;

    if (listingVariantId) {
      const catalogPublic = require("../../../catalog/public");
      const variant = await catalogPublic.getListingVariantById(listingVariantId);
      if (variant?.psdReadiness?.status === "MISSING") {
        await designPublic.createPsdTemplateTask({
          listingId,
          listingVariantId,
          orderId: payload.orderId ? String(payload.orderId) : null,
          orderItemId: payload.orderItemId ? String(payload.orderItemId) : null,
          note: "Auto-requested from Amazon post-import mapping",
          priority: "NORMAL",
        }, { system: true, source: "AMAZON_ORDER_IMPORT" });
        return;
      }
    }

    const catalogPublic = require("../../../catalog/public");
    const listing = await catalogPublic.getListingById(listingId);
    if (listing && !listing.defaultPsdTemplateAssetId) {
      await designPublic.createPsdTemplateTask({
        listingId,
        orderId: payload.orderId ? String(payload.orderId) : null,
        orderItemId: payload.orderItemId ? String(payload.orderItemId) : null,
        note: "Auto-requested from Amazon post-import mapping",
        priority: "NORMAL",
      }, { system: true, source: "AMAZON_ORDER_IMPORT" });
    }
  } catch (error) {
    logger.info("Auto PSD request skipped or already exists for Amazon fulfillment plan", {
      orderItemId: payload.orderItemId,
      listingId,
      listingVariantId,
      error: error.message,
    });
  }
}

async function processPostImportMapping(
  payload = {},
  { isFinalAttempt = false } = {},
) {
  const leaseToken = randomUUID();
  const claimed = await rawRecordRepository.claimPostImportRecords(
    getPayloadRawRecordIds(payload),
    leaseToken,
    { leaseMs: LEASE_MS },
  );
  if (!claimed) return { skipped: true };

  try {
    const result = await mappingPublic.recheckFulfillmentPlan(
      payload.orderItemId,
      { createDraftListing: true },
      {
        system: true,
        source: "EXTERNAL_ORDER_IMPORT",
      },
    );
    await autoRequestPsdForFulfillmentPlan(result, payload);
    if (result?.status === "READY") {
      await productionPublic.createOrRecheckTaskForOrderItem(
        payload.orderItemId,
        {
          system: true,
          source: "EXTERNAL_ORDER_IMPORT",
        },
      );
    }
    await updatePayloadRawRecords(payload, leaseToken, {
      postImportStatus: externalOrderPostImportStatuses.COMPLETED,
      postImportFinishedAt: new Date(),
      postImportErrorCode: null,
      postImportErrorMessage: null,
    });
    await enqueueImagesWhenImportJobIsReady(payload.importJobId, result?.shopId);
    return { skipped: false, result };
  } catch (error) {
    await updatePayloadRawRecords(payload, leaseToken, {
      postImportStatus: externalOrderPostImportStatuses.FAILED,
      postImportFinishedAt: new Date(),
      postImportErrorCode:
        error.code || externalOrderImportIssueTypes.MAPPING_RECHECK_FAILED,
      postImportErrorMessage: getErrorMessage(error),
    });
    if (isFinalAttempt) await createFailureIssue(payload, error);
    throw error;
  }
}

module.exports = {
  LEASE_MS,
  enqueueImagesWhenImportJobIsReady,
  processPostImportMapping,
};
