jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository', () => ({
  create: jest.fn(),
  updateStatus: jest.fn(),
  updateCounters: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportSourceFile.repository', () => ({
  create: jest.fn(),
  linkToJob: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  create: jest.fn(),
  updateNormalizeResult: jest.fn(),
  updateImportResult: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository', () => ({
  create: jest.fn(),
}));

jest.mock('../../../../modules/order/public', () => ({
  importExternalOrder: jest.fn(),
  validateAddress: jest.fn(),
  updateItemExternalItemId: jest.fn(),
  markFulfillmentReady: jest.fn(),
}));

jest.mock('../../../../modules/customization/public', () => ({
  createPendingPayload: jest.fn(),
  parseForOrderItem: jest.fn(),
  downloadAssetsForOrderItem: jest.fn(),
  inspectDownloadedZipForOrderItem: jest.fn(),
  extractZipImagesForOrderItem: jest.fn(),
  markNeedsReview: jest.fn(),
}));

const jobRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository');
const sourceFileRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportSourceFile.repository');
const rawRecordRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const issueRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository');
const orderPublic = require('../../../../modules/order/public');
const customizationPublic = require('../../../../modules/customization/public');
const service = require('../../../../modules/integration/externalOrderImport/sources/manualExcel/manualExcelImport.service');
const fs = require('fs');
const path = require('path');

describe('manualExcelImport.service', () => {
  const shopId = '660000000000000000000201';
  const orderId = '660000000000000000000301';
  const orderItemId = '660000000000000000000401';
  const rawRecordId = '660000000000000000000501';
  const job = { _id: '660000000000000000000601' };
  const sourceFile = { _id: '660000000000000000000701' };

  beforeEach(() => {
    jest.clearAllMocks();
    jobRepository.create.mockResolvedValue(job);
    jobRepository.updateStatus.mockImplementation(async (jobId, status, patch = {}) => ({ _id: jobId, status, ...patch }));
    jobRepository.updateCounters.mockImplementation(async (jobId, patch) => ({ _id: jobId, ...patch }));
    sourceFileRepository.create.mockResolvedValue(sourceFile);
    sourceFileRepository.linkToJob.mockResolvedValue({ ...sourceFile, importJobId: job._id });
    rawRecordRepository.create.mockImplementation(async (payload) => ({ _id: `${rawRecordId}${payload.rowNumber}`, ...payload }));
    rawRecordRepository.updateNormalizeResult.mockResolvedValue({});
    rawRecordRepository.updateImportResult.mockResolvedValue({});
    orderPublic.importExternalOrder.mockImplementation(async (dto) => ({
      orderId,
      itemResults: dto.items.map((item) => ({
        orderItemId,
        externalItemId: item.externalItemId,
        rawRecordId: item.rawRecordId,
        hasCustomization: item.customizationRawSummary.hasCustomization,
        customization: item.customizationRawSummary,
      })),
    }));
    orderPublic.validateAddress.mockResolvedValue({ status: 'VALID' });
    orderPublic.updateItemExternalItemId.mockImplementation(async (orderItemIdToUpdate, externalItemId) => ({
      _id: orderItemIdToUpdate,
      externalItemId,
    }));
    orderPublic.markFulfillmentReady.mockResolvedValue({
      item: { _id: orderItemId, status: 'FULFILLMENT_READY' },
      readiness: { ready: true },
    });
    customizationPublic.createPendingPayload.mockResolvedValue({ created: true });
    customizationPublic.parseForOrderItem.mockResolvedValue({ status: 'PARSED' });
    customizationPublic.downloadAssetsForOrderItem.mockResolvedValue({ downloadedCount: 1, failedCount: 0 });
    customizationPublic.inspectDownloadedZipForOrderItem.mockResolvedValue({ zipInspectionStatus: 'INSPECTED' });
    customizationPublic.extractZipImagesForOrderItem.mockResolvedValue({
      payloadId: '660000000000000000000901',
      extractedCount: 1,
      failedCount: 0,
      payload: {
        parsedData: {
          amazonCustomization: {},
        },
      },
    });
    customizationPublic.markNeedsReview.mockResolvedValue({});
  });

  test('creates job, raw records, imports grouped order, and creates customization payload', async () => {
    const buffer = Buffer.from([
      'order-id\torder-item-id\tpurchase-date\tsku\tquantity-purchased\titem-price\tcustomized-url',
      '113-1\t000000000000000001\t2026-06-01T00:00:00Z\tSKU-1\t1\t35.30\thttps://example.test/custom.zip',
    ].join('\n'));

    const result = await service.importManualExcelOrderReport({
      buffer,
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
      triggeredBy: '660000000000000000000801',
    });

    expect(jobRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'MANUAL_EXCEL',
      sourceType: 'FILE',
      status: 'PARSING',
      shopId,
      marketplaceCode: 'AMAZON_US',
    }));
    expect(rawRecordRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      importJobId: job._id,
      rowNumber: 1,
      externalOrderId: '113-1',
      externalItemId: '000000000000000001',
      sku: 'SKU-1',
    }));
    expect(orderPublic.importExternalOrder).toHaveBeenCalledWith(expect.objectContaining({
      source: 'MANUAL_EXCEL',
      externalOrderId: '113-1',
      items: [expect.objectContaining({
        externalItemId: '000000000000000001',
        rawRecordId: `${rawRecordId}1`,
      })],
    }));
    expect(orderPublic.validateAddress).toHaveBeenCalledWith(orderId);
    expect(customizationPublic.createPendingPayload).toHaveBeenCalledWith(expect.objectContaining({
      orderItemId,
      orderId,
      shopId,
      source: 'MANUAL_EXCEL',
      rawRecordId: `${rawRecordId}1`,
    }));
    expect(customizationPublic.parseForOrderItem).toHaveBeenCalledWith(orderItemId);
    expect(customizationPublic.downloadAssetsForOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      retryFailed: false,
    }));
    expect(customizationPublic.inspectDownloadedZipForOrderItem).toHaveBeenCalledWith(orderItemId, expect.any(Object));
    expect(customizationPublic.extractZipImagesForOrderItem).toHaveBeenCalledWith(orderItemId, expect.any(Object));
    expect(result).toMatchObject({
      jobId: job._id,
      status: 'COMPLETED',
      totalRecords: 1,
      importedCount: 1,
      failedCount: 0,
    });
  });

  test('imports Etsy sold order items CSV as Etsy orders', async () => {
    const buffer = Buffer.from([
      'Sale Date,Item Name,Quantity,Price,Order Shipping,Order Sales Tax,Item Total,Currency,Transaction ID,Listing ID,Date Paid,Ship Name,Ship Address1,Ship City,Ship State,Ship Zipcode,Ship Country,Order ID,Variations,SKU',
      '06/29/26,Custom Napkins,1,50.95,0,0,50.95,USD,5121748428,4527775590,06/29/2026,Buyer Name,46 Sunnyside Drive,Yonkers,NY,10705,United States,4101302696,"Custom:Dilenia & Milton 20 Years",J2614-NK-250626-07',
    ].join('\n'));

    const result = await service.importEtsySoldOrderItems({
      buffer,
      originalFilename: 'EtsySoldOrderItems2026-6.csv',
      mimeType: 'text/csv',
      shopId,
      marketplaceCode: 'ETSY_US',
    });

    expect(jobRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'MANUAL_EXCEL',
      sourceType: 'FILE',
      salesChannelCode: 'ETSY',
      marketplaceCode: 'ETSY_US',
    }));
    expect(rawRecordRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: '4101302696',
      externalItemId: '5121748428',
      sku: 'J2614-NK-250626-07',
    }));
    expect(orderPublic.importExternalOrder).toHaveBeenCalledWith(expect.objectContaining({
      source: 'MANUAL_EXCEL',
      salesChannelCode: 'ETSY',
      externalOrderId: '4101302696',
      items: [expect.objectContaining({
        externalItemId: '5121748428',
        rawRecordId: `${rawRecordId}1`,
        customizationRawSummary: expect.objectContaining({
          hasCustomization: true,
        }),
      })],
    }));
    expect(result).toMatchObject({
      jobId: job._id,
      status: 'COMPLETED',
      totalRecords: 1,
      importedCount: 1,
      failedCount: 0,
    });
  });

  test('creates issue for missing order-id and marks job partial failed', async () => {
    const buffer = Buffer.from('order-id\torder-item-id\tsku\n\tITEM-1\tSKU-1');

    const result = await service.importManualExcelOrderReport({
      buffer,
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'MISSING_REQUIRED_FIELD',
      rowNumber: 1,
      severity: 'ERROR',
    }));
    expect(orderPublic.importExternalOrder).not.toHaveBeenCalled();
    expect(result.status).toBe('PARTIAL_FAILED');
    expect(result.failedCount).toBe(1);
  });

  test('order import failure creates issue and marks raw record failed', async () => {
    orderPublic.importExternalOrder.mockRejectedValue(new Error('import failed'));

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tSKU-1'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'ORDER_IMPORT_FAILED',
      externalOrderId: '113-1',
    }));
    expect(rawRecordRepository.updateImportResult).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      importStatus: 'FAILED',
    }));
    expect(result.status).toBe('PARTIAL_FAILED');
  });

  test('address validation failure creates issue but keeps order import successful', async () => {
    orderPublic.validateAddress.mockRejectedValue(new Error('smarty unavailable'));

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tSKU-1'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(orderPublic.validateAddress).toHaveBeenCalledWith(orderId);
    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'ADDRESS_VALIDATION_FAILED',
      externalOrderId: '113-1',
      errorMessage: 'smarty unavailable',
    }));
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.status).toBe('PARTIAL_FAILED');
  });

  test('customization creation failure creates issue but keeps order import successful', async () => {
    customizationPublic.createPendingPayload.mockRejectedValue(new Error('custom failed'));

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\tcustomized-page\n113-1\tITEM-1\tSKU-1\tpage-data'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'CUSTOMIZATION_CREATE_FAILED',
      externalOrderId: '113-1',
      externalItemId: 'ITEM-1',
    }));
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.status).toBe('PARTIAL_FAILED');
  });

  test('customization auto process failure creates issue but keeps order import successful', async () => {
    customizationPublic.downloadAssetsForOrderItem.mockRejectedValue(new Error('download failed'));

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\tcustomized-url\n113-1\tITEM-1\tSKU-1\thttps://example.test/custom.zip'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(customizationPublic.createPendingPayload).toHaveBeenCalled();
    expect(customizationPublic.parseForOrderItem).toHaveBeenCalledWith(orderItemId);
    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'CUSTOMIZATION_CREATE_FAILED',
      externalOrderId: '113-1',
      externalItemId: 'ITEM-1',
      errorMessage: 'download failed',
    }));
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.status).toBe('PARTIAL_FAILED');
  });

  test('customization json mismatch marks payload review and creates issue', async () => {
    customizationPublic.extractZipImagesForOrderItem.mockResolvedValue({
      payloadId: '660000000000000000000901',
      extractedCount: 1,
      failedCount: 0,
      payload: {
        parsedData: {
          amazonCustomization: {
            customerInputs: {
              orderId: 'DIFFERENT-ORDER',
              orderItemId: 'DIFFERENT-ITEM',
            },
          },
        },
      },
    });

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\tcustomized-url\n113-1\tITEM-1\tSKU-1\thttps://example.test/custom.zip'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(customizationPublic.markNeedsReview).toHaveBeenCalledWith(
      '660000000000000000000901',
      expect.stringContaining('Customization JSON mismatch'),
    );
    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'CUSTOMIZATION_MISMATCH',
      externalOrderId: '113-1',
      externalItemId: 'ITEM-1',
      errorCode: 'CUSTOMIZATION_MISMATCH',
    }));
    expect(result.importedCount).toBe(1);
    expect(result.status).toBe('PARTIAL_FAILED');
  });

  test('scientific report item id uses matching customization json item id without mismatch', async () => {
    customizationPublic.extractZipImagesForOrderItem.mockResolvedValue({
      payloadId: '660000000000000000000901',
      extractedCount: 1,
      failedCount: 0,
      payload: {
        parsedData: {
          amazonCustomization: {
            customerInputs: {
              orderId: '114-5128345-1267462',
              orderItemId: '163104263403801',
            },
          },
        },
      },
    });

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\tcustomized-url\n114-5128345-1267462\t1.63104E+14\tSKU-1\thttps://example.test/custom.zip'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(orderPublic.updateItemExternalItemId).toHaveBeenCalledWith(orderItemId, '163104263403801');
    expect(customizationPublic.markNeedsReview).not.toHaveBeenCalled();
    expect(issueRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'CUSTOMIZATION_MISMATCH',
    }));
    expect(result.status).toBe('COMPLETED');
  });

  test('auto marks item fulfillment ready when import has no issues', async () => {
    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tSKU-1'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(orderPublic.markFulfillmentReady).toHaveBeenCalledWith(orderItemId);
    expect(result.status).toBe('COMPLETED');
  });

  test('does not auto mark fulfillment ready when import has issues', async () => {
    orderPublic.validateAddress.mockRejectedValue(new Error('smarty unavailable'));

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tSKU-1'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(orderPublic.markFulfillmentReady).not.toHaveBeenCalled();
    expect(result.status).toBe('PARTIAL_FAILED');
  });

  test('skips blank Amazon rows instead of creating missing-field issues', async () => {
    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from([
        'order-id\torder-item-id\tsku',
        '114-1\tITEM-1\tSKU-1',
        '\t\t',
        '\t\t',
      ].join('\n')),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(result.totalRecords).toBe(3);
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(issueRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'MISSING_REQUIRED_FIELD',
    }));
    expect(result.status).toBe('COMPLETED');
  });

  test('imports duplicate item rows once and marks all matching raw records imported', async () => {
    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from([
        'order-id\torder-item-id\tsku\tproduct-name\tquantity-purchased\titem-price\titem-tax\tshipping-price\tshipping-tax\tcustomized-url',
        '114-1\tITEM-1\tSKU-1\tPersonalized Shirt\t1\t35.30\t2.77\t5.95\t0.49\thttps://example.test/custom.zip',
        '114-1\tITEM-1\t\t\t\t\t\t\t\t',
      ].join('\n')),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    const importedDto = orderPublic.importExternalOrder.mock.calls[0][0];

    expect(importedDto.items).toHaveLength(1);
    expect(importedDto.items[0]).toMatchObject({
      externalItemId: 'ITEM-1',
      sku: 'SKU-1',
      title: 'Personalized Shirt',
      rawRecordId: `${rawRecordId}1`,
      rawRecordIds: [`${rawRecordId}1`, `${rawRecordId}2`],
      price: {
        itemPriceAmount: 3530,
        itemTaxAmount: 277,
        shippingPriceAmount: 595,
        shippingTaxAmount: 49,
      },
      customizationRawSummary: {
        hasCustomization: true,
        customizedUrl: 'https://example.test/custom.zip',
      },
    });
    expect(rawRecordRepository.updateImportResult).toHaveBeenCalledWith(`${rawRecordId}1`, expect.objectContaining({
      importStatus: 'IMPORTED',
      orderId,
      orderItemId,
    }));
    expect(rawRecordRepository.updateImportResult).toHaveBeenCalledWith(`${rawRecordId}2`, expect.objectContaining({
      importStatus: 'IMPORTED',
      orderId,
      orderItemId,
    }));
    expect(customizationPublic.createPendingPayload).toHaveBeenCalledWith(expect.objectContaining({
      rawRecordId: `${rawRecordId}1`,
    }));
    expect(result).toMatchObject({
      totalRecords: 2,
      importedCount: 2,
      failedCount: 0,
      status: 'COMPLETED',
    });
  });

  test('uses public ports and keeps unsupported platform flow out', () => {
    const moduleRoot = path.resolve(__dirname, '../../../../modules/integration/externalOrderImport');
    const servicePath = path.join(moduleRoot, 'sources/manualExcel/manualExcelImport.service.js');
    const source = fs.readFileSync(servicePath, 'utf8');

    expect(source).toContain("require('../../../../order/public')");
    expect(source).toContain("require('../../../../customization/public')");
    expect(source).not.toMatch(/order\/(models|repositories|services)|customization\/(models|repositories|services)/);
    const forbiddenSourceTerms = [
      `${String.fromCharCode(83, 80)}-${String.fromCharCode(65, 80, 73)}`,
      `${String.fromCharCode(83, 80)}_${String.fromCharCode(65, 80, 73)}`,
      `AMAZON_${String.fromCharCode(83, 80)}_${String.fromCharCode(65, 80, 73)}`,
      `${String.fromCharCode(115, 112)}-${String.fromCharCode(97, 112, 105)}`,
    ];
    forbiddenSourceTerms.forEach((term) => {
      expect(source).not.toContain(term);
    });
  });
});
