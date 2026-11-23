jest.mock(
  "../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository",
  () => ({
    claimPostImportRecords: jest.fn(),
    updatePostImportResultForLease: jest.fn(),
    listAllByJob: jest.fn(),
  }),
);

jest.mock(
  "../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository",
  () => ({
    create: jest.fn(),
  }),
);

jest.mock("../../../../src/modules/mapping/public", () => ({
  recheckFulfillmentPlan: jest.fn(),
}));
jest.mock("../../../../src/modules/order/public", () => ({ findItemsByIds: jest.fn() }));

jest.mock("../../../../src/modules/production/public", () => ({
  createOrRecheckTaskForOrderItem: jest.fn(),
}));

jest.mock("../../../../src/modules/integration/listingImageSync/public", () => ({
  enqueueImportedOrderImages: jest.fn(),
}));

jest.mock("../../../../src/modules/design/public", () => ({
  createPsdTemplateTask: jest.fn().mockResolvedValue({ created: true }),
}));

jest.mock("../../../../src/modules/catalog/public", () => ({
  getListingById: jest.fn().mockResolvedValue(null),
  getListingVariantById: jest.fn().mockResolvedValue(null),
}));

const rawRecordRepository = require("../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository");
const issueRepository = require("../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository");
const mappingPublic = require("../../../../src/modules/mapping/public");
const orderPublic = require("../../../../src/modules/order/public");
const productionPublic = require("../../../../src/modules/production/public");
const listingImageSync = require("../../../../src/modules/integration/listingImageSync/public");
const designPublic = require("../../../../src/modules/design/public");
const catalogPublic = require("../../../../src/modules/catalog/public");
const {
  processPostImportMappingJob,
} = require("../../../../src/modules/integration/externalOrderImport/workers/postImportMapping.worker");

describe("postImportMapping.worker", () => {
  const payload = {
    importJobId: "660000000000000000000601",
    rawRecordId: "660000000000000000000501",
    rawRecordIds: ["660000000000000000000501", "660000000000000000000502"],
    orderId: "660000000000000000000301",
    orderItemId: "660000000000000000000401",
    externalOrderId: "113-1",
    externalItemId: "ITEM-1",
    asin: "B012345678",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orderPublic.findItemsByIds.mockResolvedValue([]);
    rawRecordRepository.claimPostImportRecords.mockResolvedValue(true);
    rawRecordRepository.updatePostImportResultForLease.mockResolvedValue({});
    rawRecordRepository.listAllByJob.mockResolvedValue([]);
    issueRepository.create.mockResolvedValue({});
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({
      status: "BLOCKED",
    });
    productionPublic.createOrRecheckTaskForOrderItem.mockResolvedValue({
      id: "660000000000000000000701",
    });
    listingImageSync.enqueueImportedOrderImages.mockResolvedValue(null);
  });

  test("runs mapping recheck and marks all raw records completed", async () => {
    await processPostImportMappingJob({ data: payload });

    expect(rawRecordRepository.claimPostImportRecords).toHaveBeenCalledWith(
      payload.rawRecordIds,
      expect.any(String),
      expect.objectContaining({ leaseMs: expect.any(Number) }),
    );
    expect(mappingPublic.recheckFulfillmentPlan).toHaveBeenCalledWith(
      payload.orderItemId,
      {
        createDraftListing: true,
      },
      {
        system: true,
        source: "EXTERNAL_ORDER_IMPORT",
      },
    );
    expect(
      rawRecordRepository.updatePostImportResultForLease,
    ).toHaveBeenCalledWith(
      "660000000000000000000501",
      expect.any(String),
      expect.objectContaining({
        postImportStatus: "COMPLETED",
        postImportErrorCode: null,
      }),
    );
    expect(issueRepository.create).not.toHaveBeenCalled();
  });

  test("auto-requests PSD when an Amazon mapping plan has no PSD", async () => {
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({
      status: "BLOCKED",
      salesChannelCode: "AMAZON",
      listingId: "660000000000000000000801",
    });
    catalogPublic.getListingById.mockResolvedValue({
      _id: "660000000000000000000801",
      defaultPsdTemplateAssetId: null,
    });
    designPublic.createPsdTemplateTask.mockResolvedValue({ created: true });

    await processPostImportMappingJob({ data: payload });

    expect(designPublic.createPsdTemplateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: "660000000000000000000801",
        orderId: payload.orderId,
        orderItemId: payload.orderItemId,
        priority: "NORMAL",
      }),
      { system: true, source: "AMAZON_ORDER_IMPORT" },
    );
  });

  test("marks failed and creates import issue when mapping throws", async () => {
    mappingPublic.recheckFulfillmentPlan.mockRejectedValue(
      new Error("mapping down"),
    );

    await expect(
      processPostImportMappingJob({ data: payload }),
    ).rejects.toThrow("mapping down");

    expect(
      rawRecordRepository.updatePostImportResultForLease,
    ).toHaveBeenCalledWith(
      "660000000000000000000501",
      expect.any(String),
      expect.objectContaining({
        postImportStatus: "FAILED",
        postImportErrorCode: "MAPPING_RECHECK_FAILED",
        postImportErrorMessage: "mapping down",
      }),
    );
    expect(issueRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        importJobId: payload.importJobId,
        rawRecordId: payload.rawRecordId,
        externalOrderId: payload.externalOrderId,
        externalItemId: payload.externalItemId,
        issueType: "MAPPING_RECHECK_FAILED",
        errorMessage: "mapping down",
      }),
    );
  });

  test("creates a production task after a ready mapping recheck", async () => {
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: "READY" });

    await processPostImportMappingJob({ data: payload });

    expect(
      productionPublic.createOrRecheckTaskForOrderItem,
    ).toHaveBeenCalledWith(
      payload.orderItemId,
      expect.objectContaining({
        system: true,
        source: "EXTERNAL_ORDER_IMPORT",
      }),
    );
  });

  test("queues one deduplicated ASIN batch only after the import job has finished post-import mapping", async () => {
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: "BLOCKED", shopId: "660000000000000000000201" });
    rawRecordRepository.listAllByJob.mockResolvedValue([
      { importStatus: "IMPORTED", postImportStatus: "COMPLETED", asin: "B012345678" },
      { importStatus: "IMPORTED", postImportStatus: "COMPLETED", asin: "b098765432" },
      { importStatus: "IMPORTED", postImportStatus: "COMPLETED", asin: "B012345678" },
    ]);

    await processPostImportMappingJob({ data: payload });

    expect(listingImageSync.enqueueImportedOrderImages).toHaveBeenCalledWith({
      shopId: "660000000000000000000201",
      asins: ["B012345678", "B098765432"],
    });
    expect(rawRecordRepository.updatePostImportResultForLease).toHaveBeenCalledWith(
      payload.rawRecordId,
      expect.any(String),
      expect.objectContaining({ postImportStatus: "COMPLETED" }),
    );
  });

  test.each(["B0HQJ6F2KL", null])("uses resolved item ASINs with another raw ASIN %s and deduplicates the batch", async (rawAsin) => {
    const shopId = "660000000000000000000201";
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: "BLOCKED", shopId });
    rawRecordRepository.listAllByJob.mockResolvedValue([
      { postImportStatus: "COMPLETED", asin: null, orderItemId: payload.orderItemId },
      { postImportStatus: "COMPLETED", asin: "  ", orderItemId: payload.orderItemId },
      { postImportStatus: "COMPLETED", asin: rawAsin },
      { postImportStatus: "SKIPPED", asin: null, orderItemId: "missing-item" },
    ]);
    orderPublic.findItemsByIds.mockResolvedValue([
      { _id: payload.orderItemId, shopId, salesChannelCode: "AMAZON", asin: "b0hqj6f2kl" },
    ]);
    await processPostImportMappingJob({ data: payload });
    expect(orderPublic.findItemsByIds).toHaveBeenCalledTimes(1);
    expect(orderPublic.findItemsByIds).toHaveBeenCalledWith([payload.orderItemId, "missing-item"]);
    expect(listingImageSync.enqueueImportedOrderImages).toHaveBeenCalledTimes(1);
    expect(listingImageSync.enqueueImportedOrderImages).toHaveBeenCalledWith({ shopId, asins: ["B0HQJ6F2KL"] });
  });

  test("does not enqueue fallback ASINs from another shop or Etsy", async () => {
    const shopId = "660000000000000000000201";
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: "BLOCKED", shopId });
    rawRecordRepository.listAllByJob.mockResolvedValue([
      { postImportStatus: "COMPLETED", orderItemId: "foreign" },
      { postImportStatus: "COMPLETED", orderItemId: "etsy" },
    ]);
    orderPublic.findItemsByIds.mockResolvedValue([
      { _id: "foreign", shopId: "other", salesChannelCode: "AMAZON", asin: "B0HQJ6F2KL" },
      { _id: "etsy", shopId, salesChannelCode: "ETSY", asin: "B0HQJ6F2KL" },
    ]);
    await processPostImportMappingJob({ data: payload });
    expect(listingImageSync.enqueueImportedOrderImages).not.toHaveBeenCalled();
  });

  test("does not queue images while another imported record is still pending", async () => {
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: "BLOCKED", shopId: "660000000000000000000201" });
    rawRecordRepository.listAllByJob.mockResolvedValue([
      { importStatus: "IMPORTED", postImportStatus: "COMPLETED", asin: "B012345678" },
      { importStatus: "IMPORTED", postImportStatus: "QUEUED", asin: "B098765432" },
    ]);

    await processPostImportMappingJob({ data: payload });

    expect(listingImageSync.enqueueImportedOrderImages).not.toHaveBeenCalled();
  });

  test("skips mapping when another worker already owns the lease", async () => {
    rawRecordRepository.claimPostImportRecords.mockResolvedValue(false);

    await processPostImportMappingJob({ data: payload });

    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
    expect(
      rawRecordRepository.updatePostImportResultForLease,
    ).not.toHaveBeenCalled();
  });
});
