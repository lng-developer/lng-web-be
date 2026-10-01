jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository', () => ({
  create: jest.fn(),
  updateStatus: jest.fn(),
  updateCounters: jest.fn(),
  findById: jest.fn(),
  findByIdempotency: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportSourceFile.repository', () => ({
  create: jest.fn(),
  findByIdWithContent: jest.fn(),
  linkToJob: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  create: jest.fn(),
  createMany: jest.fn(),
  listAllByJob: jest.fn(),
  updateNormalizeResult: jest.fn(),
  updateImportResult: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository', () => ({
  create: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/services/postImportMappingQueue.service', () => ({
  enqueuePostImportMappingJob: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/services/customizationAssetQueue.service', () => ({
  enqueueCustomizationAssetJob: jest.fn(),
}));

jest.mock('../../../../src/modules/order/public', () => ({
  importExternalOrder: jest.fn(),
  validateAddress: jest.fn(),
  ensureOpenOrderCase: jest.fn(),
  updateItemExternalItemId: jest.fn(),
  updateItemAsin: jest.fn(),
  transitionItemStatus: jest.fn(),
  markFulfillmentReady: jest.fn(),
}));

jest.mock('../../../../src/modules/mapping/public', () => ({
  normalizeSkuForContext: jest.fn(async (sku) => ({
    originalSku: String(sku || '').trim().toUpperCase(),
    canonicalSku: String(sku || '').trim().toUpperCase(),
    appliedRuleIds: [],
    removedSegments: [],
    replacedSegments: [],
  })),
  recheckFulfillmentPlan: jest.fn(),
}));

jest.mock('../../../../src/modules/customization/public', () => ({
  createPendingPayload: jest.fn(),
  parseForOrderItem: jest.fn(),
  downloadAssetsForOrderItem: jest.fn(),
  inspectDownloadedZipForOrderItem: jest.fn(),
  extractZipImagesForOrderItem: jest.fn(),
  markNeedsReview: jest.fn(),
}));

const jobRepository = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository');
const sourceFileRepository = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportSourceFile.repository');
const rawRecordRepository = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const issueRepository = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository');
const postImportMappingQueue = require('../../../../src/modules/integration/externalOrderImport/services/postImportMappingQueue.service');
const customizationAssetQueue = require('../../../../src/modules/integration/externalOrderImport/services/customizationAssetQueue.service');
const orderPublic = require('../../../../src/modules/order/public');
const mappingPublic = require('../../../../src/modules/mapping/public');
const customizationPublic = require('../../../../src/modules/customization/public');
const service = require('../../../../src/modules/integration/externalOrderImport/sources/manualExcel/manualExcelImport.service');
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
    jobRepository.findByIdempotency.mockResolvedValue(null);
    jobRepository.updateStatus.mockImplementation(async (jobId, status, patch = {}) => ({ _id: jobId, status, ...patch }));
    jobRepository.updateCounters.mockImplementation(async (jobId, patch) => ({ _id: jobId, ...patch }));
    sourceFileRepository.create.mockResolvedValue(sourceFile);
    sourceFileRepository.findByIdWithContent.mockResolvedValue({ ...sourceFile, contentBase64: Buffer.from('').toString('base64') });
    sourceFileRepository.linkToJob.mockResolvedValue({ ...sourceFile, importJobId: job._id });
    rawRecordRepository.create.mockImplementation(async (payload) => ({ _id: `${rawRecordId}${payload.rowNumber}`, ...payload }));
    rawRecordRepository.createMany.mockImplementation(async (payloads) => (
      payloads.map((payload) => ({ _id: `${rawRecordId}${payload.rowNumber}`, ...payload }))
    ));
    rawRecordRepository.listAllByJob.mockResolvedValue([]);
    rawRecordRepository.updateNormalizeResult.mockResolvedValue({});
    rawRecordRepository.updateImportResult.mockResolvedValue({});
    postImportMappingQueue.enqueuePostImportMappingJob.mockResolvedValue({ queued: true });
    customizationAssetQueue.enqueueCustomizationAssetJob.mockResolvedValue({ queued: true });
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
    orderPublic.updateItemAsin.mockImplementation(async (orderItemIdToUpdate, asin) => ({
      _id: orderItemIdToUpdate,
      asin,
    }));
    orderPublic.transitionItemStatus.mockResolvedValue({
      _id: orderItemId,
      status: 'CUSTOMIZATION_PARSED',
    });
    orderPublic.markFulfillmentReady.mockResolvedValue({
      item: { _id: orderItemId, status: 'FULFILLMENT_READY' },
      readiness: { ready: true },
    });
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: 'READY' });
    mappingPublic.normalizeSkuForContext.mockImplementation(async (sku) => ({
      originalSku: String(sku || '').trim().toUpperCase(),
      canonicalSku: String(sku || '').trim().toUpperCase(),
      appliedRuleIds: [],
      removedSegments: [],
      replacedSegments: [],
    }));
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

  test('returns the original queued Etsy job for a repeated idempotency key', async () => {
    jobRepository.findByIdempotency.mockResolvedValue({
      _id: job._id,
      status: 'PENDING',
      totalRecords: 2,
    });

    const result = await service.prepareQueuedEtsySoldOrderItems({
      buffer: Buffer.from('Order ID,Transaction ID\n1,2'),
      originalFilename: 'etsy.csv',
      mimeType: 'text/csv',
      shopId,
      marketplaceCode: 'ETSY_US',
      idempotencyKey: '507f1f77bcf86cd799439012',
    });

    expect(result).toMatchObject({ jobId: job._id, status: 'PENDING', totalRecords: 2 });
    expect(jobRepository.create).not.toHaveBeenCalled();
    expect(sourceFileRepository.create).not.toHaveBeenCalled();
  });

  test('prepares an import job without importing orders in the upload request', async () => {
    const result = await service.prepareManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tSKU-1'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(result).toMatchObject({
      jobId: job._id,
      status: 'PENDING',
      totalRecords: 1,
      parsedCount: 1,
    });
    expect(orderPublic.importExternalOrder).not.toHaveBeenCalled();
    expect(rawRecordRepository.createMany).toHaveBeenCalledTimes(1);
  });

  test('preserves extension report source for queued Amazon uploads', async () => {
    await service.prepareQueuedManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tSKU-1'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON',
      source: 'AMAZON_EXTENSION_REPORT',
    });

    expect(jobRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'AMAZON_EXTENSION_REPORT',
    }));
    expect(sourceFileRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'AMAZON_EXTENSION_REPORT',
    }));
  });

  test('marks every extension row skipped and bypasses post-import work for an existing order', async () => {
    orderPublic.importExternalOrder.mockResolvedValue({ orderId, skipped: true, itemResults: [] });

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tSKU-1'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
      source: 'AMAZON_EXTENSION_REPORT',
    });

    expect(rawRecordRepository.updateImportResult).toHaveBeenCalledWith(`${rawRecordId}1`, {
      importStatus: 'SKIPPED',
      orderId,
    });
    expect(orderPublic.validateAddress).not.toHaveBeenCalled();
    expect(customizationPublic.createPendingPayload).not.toHaveBeenCalled();
    expect(postImportMappingQueue.enqueuePostImportMappingJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'COMPLETED', importedCount: 0, skippedCount: 1, failedCount: 0 });
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
      externalAccountId: 'SELLER-1',
      triggeredBy: '660000000000000000000801',
    });

    expect(jobRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'MANUAL_EXCEL',
      sourceType: 'FILE',
      status: 'PARSING',
      shopId,
      marketplaceCode: 'AMAZON_US',
    }));
    expect(rawRecordRepository.createMany).toHaveBeenCalledWith([expect.objectContaining({
      importJobId: job._id,
      rowNumber: 1,
      externalOrderId: '113-1',
      externalItemId: '000000000000000001',
      sku: 'SKU-1',
    })]);
    expect(orderPublic.importExternalOrder).toHaveBeenCalledWith(expect.objectContaining({
      source: 'MANUAL_EXCEL',
      externalOrderId: '113-1',
      externalAccountId: 'SELLER-1',
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
    expect(customizationPublic.parseForOrderItem).not.toHaveBeenCalled();
    expect(customizationPublic.downloadAssetsForOrderItem).not.toHaveBeenCalled();
    expect(customizationAssetQueue.enqueueCustomizationAssetJob).toHaveBeenCalledWith(expect.objectContaining({
      importJobId: job._id,
      rawRecordId: `${rawRecordId}1`,
      orderId,
      orderItemId,
      externalOrderId: '113-1',
      externalItemId: '000000000000000001',
      source: 'EXTERNAL_ORDER_IMPORT',
    }));
    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
    expect(postImportMappingQueue.enqueuePostImportMappingJob).not.toHaveBeenCalled();
    expect(orderPublic.markFulfillmentReady).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      jobId: job._id,
      status: 'COMPLETED',
      totalRecords: 1,
      importedCount: 1,
      failedCount: 0,
      postImportQueuedCount: 0,
    });
  });

  test('normalizes SKU before importing order while keeping raw record SKU unchanged', async () => {
    mappingPublic.normalizeSkuForContext.mockResolvedValue({
      originalSku: 'J2522-CNL-08012026-21',
      canonicalSku: 'J2542-CNL-08012026-21',
      appliedRuleIds: ['rule-1'],
      removedSegments: [],
      replacedSegments: [{ index: 0, from: 'J2522', to: 'J2542', role: 'CONFIG' }],
    });

    await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tJ2522-CNL-08012026-21'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(rawRecordRepository.createMany).toHaveBeenCalledWith([expect.objectContaining({
      sku: 'J2522-CNL-08012026-21',
    })]);
    expect(orderPublic.importExternalOrder).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({
        sku: 'J2542-CNL-08012026-21',
        externalData: expect.objectContaining({
          originalSku: 'J2522-CNL-08012026-21',
          skuNormalization: expect.objectContaining({
            canonicalSku: 'J2542-CNL-08012026-21',
          }),
        }),
      })],
    }));
  });

  test('customization import only enqueues asset processing before mapping', async () => {
    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\tcustomized-url\n113-1\tITEM-1\tSKU-1\thttps://example.test/custom.zip'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(customizationPublic.createPendingPayload).toHaveBeenCalled();
    expect(customizationAssetQueue.enqueueCustomizationAssetJob).toHaveBeenCalledWith(expect.objectContaining({
      orderItemId,
      rawRecordIds: [`${rawRecordId}1`],
    }));
    expect(postImportMappingQueue.enqueuePostImportMappingJob).not.toHaveBeenCalled();
    expect(issueRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'CUSTOMIZATION_CREATE_FAILED',
    }));
    expect(result.status).toBe('COMPLETED');
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
    expect(rawRecordRepository.createMany).toHaveBeenCalledWith([expect.objectContaining({
      externalOrderId: '4101302696',
      externalItemId: '5121748428',
      sku: 'J2614-NK-250626-07',
    })]);
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
    expect(orderPublic.ensureOpenOrderCase).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      caseType: 'ADDRESS',
      severity: 'HIGH',
      title: 'Address validation failed',
      description: 'smarty unavailable',
    }), { system: true });
    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'ADDRESS_VALIDATION_FAILED',
      externalOrderId: '113-1',
      errorMessage: 'smarty unavailable',
    }));
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.status).toBe('PARTIAL_FAILED');
  });

  test('post-import queue failure is recorded on raw record but keeps order import successful', async () => {
    postImportMappingQueue.enqueuePostImportMappingJob.mockResolvedValue({ queued: false });

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tSKU-1'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
    expect(postImportMappingQueue.enqueuePostImportMappingJob).toHaveBeenCalled();
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.status).toBe('COMPLETED');
    expect(result.postImportQueuedCount).toBe(0);
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

  test('customization asset queue failure creates issue but keeps order import successful', async () => {
    customizationAssetQueue.enqueueCustomizationAssetJob.mockResolvedValue({
      queued: false,
      errorCode: 'CUSTOMIZATION_ASSET_QUEUE_UNAVAILABLE',
      errorMessage: 'Redis queue is disabled',
    });

    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\tcustomized-url\n113-1\tITEM-1\tSKU-1\thttps://example.test/custom.zip'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(customizationPublic.createPendingPayload).toHaveBeenCalled();
    expect(customizationPublic.parseForOrderItem).not.toHaveBeenCalled();
    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'CUSTOMIZATION_CREATE_FAILED',
      externalOrderId: '113-1',
      externalItemId: 'ITEM-1',
      errorMessage: 'Redis queue is disabled',
    }));
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.status).toBe('PARTIAL_FAILED');
  });

  test('does not mark item fulfillment ready before post-import mapping runs', async () => {
    const result = await service.importManualExcelOrderReport({
      buffer: Buffer.from('order-id\torder-item-id\tsku\n113-1\tITEM-1\tSKU-1'),
      originalFilename: 'orders.txt',
      mimeType: 'text/plain',
      shopId,
      marketplaceCode: 'AMAZON_US',
    });

    expect(orderPublic.markFulfillmentReady).not.toHaveBeenCalled();
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
    const moduleRoot = path.resolve(__dirname, '../../../../src/modules/integration/externalOrderImport');
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
