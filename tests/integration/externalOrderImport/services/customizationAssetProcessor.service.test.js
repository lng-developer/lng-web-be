jest.mock('../../../../src/modules/order/public', () => ({
  findItemById: jest.fn(),
  transitionItemStatus: jest.fn(),
  updateItemExternalItemId: jest.fn(),
  updateItemAsin: jest.fn(),
  updateItemListingId: jest.fn(),
  syncOrderWorkbenchListingImage: jest.fn(),
}));

jest.mock('../../../../src/modules/catalog/public', () => ({
  findOrCreateDraftListingForOrderItem: jest.fn(),
}));

jest.mock('../../../../src/modules/customization/public', () => ({
  parseForOrderItem: jest.fn(),
  downloadAssetsForOrderItem: jest.fn(),
  inspectDownloadedZipForOrderItem: jest.fn(),
  extractZipImagesForOrderItem: jest.fn(),
  markNeedsReview: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  updatePostImportResult: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository', () => ({
  create: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/services/postImportMappingQueue.service', () => ({
  enqueuePostImportMappingJob: jest.fn(),
}));

const orderPublic = require('../../../../src/modules/order/public');
const catalogPublic = require('../../../../src/modules/catalog/public');
const customizationPublic = require('../../../../src/modules/customization/public');
const issueRepository = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository');
const postImportMappingQueue = require('../../../../src/modules/integration/externalOrderImport/services/postImportMappingQueue.service');
const { processCustomizationAssets } = require('../../../../src/modules/integration/externalOrderImport/services/customizationAssetProcessor.service');

describe('customizationAssetProcessor.service', () => {
  const payload = {
    importJobId: 'job-1',
    rawRecordId: 'raw-1',
    rawRecordIds: ['raw-1'],
    orderId: 'order-1',
    orderItemId: 'item-1',
    externalOrderId: '113-1',
    externalItemId: 'ITEM-1',
    source: 'EXTERNAL_ORDER_IMPORT',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    customizationPublic.parseForOrderItem.mockResolvedValue({ status: 'PARSED' });
    customizationPublic.downloadAssetsForOrderItem.mockResolvedValue({ downloadedCount: 1 });
    customizationPublic.inspectDownloadedZipForOrderItem.mockResolvedValue({ zipInspectionStatus: 'INSPECTED' });
    customizationPublic.extractZipImagesForOrderItem.mockResolvedValue({
      payloadId: 'payload-1',
      payload: { parsedData: { amazonCustomization: { customerInputs: {} } } },
    });
    orderPublic.findItemById.mockResolvedValue({
      id: 'item-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      sku: 'SKU-1',
      title: 'Test listing',
      price: { currency: 'USD' },
      listingId: 'listing-1',
    });
    catalogPublic.findOrCreateDraftListingForOrderItem.mockResolvedValue({
      id: 'listing-1',
      productImageUrl: 'https://m.media-amazon.com/images/I/preview.png',
    });
    orderPublic.syncOrderWorkbenchListingImage.mockResolvedValue({ modifiedCount: 1 });
    postImportMappingQueue.enqueuePostImportMappingJob.mockResolvedValue({ queued: true });
  });

  test('processes assets before enqueueing post-import mapping', async () => {
    await processCustomizationAssets(payload);

    expect(customizationPublic.parseForOrderItem).toHaveBeenCalledWith('item-1');
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith('item-1', 'CUSTOMIZATION_PARSED', expect.any(Object));
    expect(customizationPublic.downloadAssetsForOrderItem).toHaveBeenCalledWith('item-1', expect.any(Object));
    expect(customizationPublic.inspectDownloadedZipForOrderItem).toHaveBeenCalledWith('item-1', expect.any(Object));
    expect(customizationPublic.extractZipImagesForOrderItem).toHaveBeenCalledWith('item-1', expect.any(Object));
    expect(postImportMappingQueue.enqueuePostImportMappingJob).toHaveBeenCalledWith(expect.objectContaining({
      orderItemId: 'item-1',
    }));
  });

  test('marks customization mismatch for review', async () => {
    customizationPublic.extractZipImagesForOrderItem.mockResolvedValue({
      payloadId: 'payload-1',
      payload: {
        parsedData: {
          amazonCustomization: {
            customerInputs: { orderId: 'DIFFERENT', orderItemId: 'OTHER' },
          },
        },
      },
    });

    await processCustomizationAssets(payload);

    expect(customizationPublic.markNeedsReview).toHaveBeenCalledWith('payload-1', expect.stringContaining('Customization JSON mismatch'));
    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'CUSTOMIZATION_MISMATCH',
      externalOrderId: '113-1',
      externalItemId: 'ITEM-1',
    }));
  });

  test('backfills asin and canonical scientific item id', async () => {
    customizationPublic.extractZipImagesForOrderItem.mockResolvedValue({
      payloadId: 'payload-1',
      payload: {
        parsedData: {
          amazonCustomization: {
            customerInputs: {
              orderId: '114-5128345-1267462',
              orderItemId: '163104263403801',
              asin: 'B0TESTASIN',
            },
          },
        },
      },
    });

    await processCustomizationAssets({
      ...payload,
      externalOrderId: '114-5128345-1267462',
      externalItemId: '1.63104E+14',
      asin: null,
    });

    expect(orderPublic.updateItemAsin).toHaveBeenCalledWith('item-1', 'B0TESTASIN');
    expect(orderPublic.updateItemExternalItemId).toHaveBeenCalledWith('item-1', '163104263403801');
    expect(issueRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'CUSTOMIZATION_MISMATCH',
    }));
  });

  test('uses parsed listing preview as the fallback Listing image', async () => {
    customizationPublic.extractZipImagesForOrderItem.mockResolvedValue({
      payload: {
        parsedData: {
          amazonCustomization: {
            customerInputs: { listingPreviewImageUrl: 'https://m.media-amazon.com/images/I/preview.png' },
          },
        },
      },
    });

    await processCustomizationAssets(payload);

    expect(catalogPublic.findOrCreateDraftListingForOrderItem).toHaveBeenCalledWith(expect.objectContaining({
      asin: 'B0TESTASIN',
      productImageUrl: 'https://m.media-amazon.com/images/I/preview.png',
    }), expect.objectContaining({ system: true }));
    expect(orderPublic.syncOrderWorkbenchListingImage).toHaveBeenCalledWith(
      'listing-1',
      'https://m.media-amazon.com/images/I/preview.png',
    );
  });
});
