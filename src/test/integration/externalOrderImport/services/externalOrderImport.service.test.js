jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository', () => ({
  findById: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository', () => ({
  list: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  listAllByJob: jest.fn(),
  listByJob: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/sources/manualExcel/manualExcelImport.service', () => ({
  importManualExcelOrderReport: jest.fn(),
  importEtsySoldOrderItems: jest.fn(),
  retryManualImportJob: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/services/postImportMappingQueue.service', () => ({
  enqueuePostImportMappingJob: jest.fn(),
}));

jest.mock('../../../../modules/order/public', () => ({
  findItemById: jest.fn(),
}));

jest.mock('../../../../modules/mapping/public', () => ({
  listFulfillmentPlansByOrderItemIds: jest.fn(),
}));

jest.mock('../../../../modules/production/public', () => ({
  listTaskSummariesByOrderItemIds: jest.fn(),
}));

const jobRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository');
const issueRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository');
const rawRecordRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const manualExcelImportService = require('../../../../modules/integration/externalOrderImport/sources/manualExcel/manualExcelImport.service');
const postImportMappingQueue = require('../../../../modules/integration/externalOrderImport/services/postImportMappingQueue.service');
const orderPublic = require('../../../../modules/order/public');
const mappingPublic = require('../../../../modules/mapping/public');
const productionPublic = require('../../../../modules/production/public');
const service = require('../../../../modules/integration/externalOrderImport/services/externalOrderImport.service');

describe('externalOrderImport.service issue workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jobRepository.findById.mockResolvedValue({ _id: '660000000000000000000601', status: 'COMPLETED' });
    issueRepository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    rawRecordRepository.listAllByJob.mockResolvedValue([]);
    manualExcelImportService.retryManualImportJob.mockResolvedValue({ replayedRawRecords: 0 });
    postImportMappingQueue.enqueuePostImportMappingJob.mockResolvedValue({ queued: true });
    orderPublic.findItemById.mockResolvedValue(null);
    mappingPublic.listFulfillmentPlansByOrderItemIds.mockResolvedValue([]);
    productionPublic.listTaskSummariesByOrderItemIds.mockResolvedValue([]);
  });

  test('lists issues with external order filters', async () => {
    await service.listIssues({
      externalOrderId: '114-1',
      externalItemId: 'ITEM-1',
      issueType: 'CUSTOMIZATION_MISMATCH',
      status: 'OPEN',
    });

    expect(issueRepository.list).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: '114-1',
      externalItemId: 'ITEM-1',
      issueType: 'CUSTOMIZATION_MISMATCH',
      status: 'OPEN',
    }));
  });

  test('does not expose manual resolve or ignore actions', () => {
    expect(service.resolveIssue).toBeUndefined();
    expect(service.ignoreIssue).toBeUndefined();
  });

  test('getImportJob includes raw, post-import, order, plan, and production summary', async () => {
    rawRecordRepository.listAllByJob.mockResolvedValue([
      {
        _id: '660000000000000000000501',
        importStatus: 'IMPORTED',
        normalizeStatus: 'NORMALIZED',
        postImportStatus: 'COMPLETED',
        orderItemId: '660000000000000000000401',
      },
      {
        _id: '660000000000000000000502',
        importStatus: 'IMPORTED',
        normalizeStatus: 'NORMALIZED',
        postImportStatus: 'FAILED',
        orderItemId: '660000000000000000000402',
      },
    ]);
    orderPublic.findItemById
      .mockResolvedValueOnce({ _id: '660000000000000000000401', listingId: 'listing-1', status: 'FULFILLMENT_READY' })
      .mockResolvedValueOnce({ _id: '660000000000000000000402', listingId: null, status: 'NEED_PRODUCTION' });
    mappingPublic.listFulfillmentPlansByOrderItemIds.mockResolvedValue([
      { orderItemId: '660000000000000000000401', status: 'READY' },
      { orderItemId: '660000000000000000000402', status: 'BLOCKED' },
    ]);
    productionPublic.listTaskSummariesByOrderItemIds.mockResolvedValue([
      { orderItemId: '660000000000000000000402', productionStatus: 'BLOCKED', scaleStatus: 'NEED_SCALE' },
    ]);

    const job = await service.getImportJob('660000000000000000000601');

    expect(job.summary).toMatchObject({
      rawRecords: { total: 2, normalized: 2, imported: 2 },
      postImport: { completed: 1, failed: 1 },
      orderItems: { total: 2, linkedListing: 1, fulfillmentReady: 1, needProduction: 1 },
      plans: { ready: 1, blocked: 1 },
      productionTasks: { total: 1, blocked: 1, needScale: 1 },
    });
  });

  test('retryImportJob replays non-imported rows and requeues failed post-import rows', async () => {
    rawRecordRepository.listAllByJob.mockResolvedValue([
      {
        _id: '660000000000000000000501',
        importJobId: '660000000000000000000601',
        importStatus: 'IMPORTED',
        postImportStatus: 'FAILED',
        orderId: '660000000000000000000301',
        orderItemId: '660000000000000000000401',
        externalOrderId: '113-1',
        externalItemId: 'ITEM-1',
      },
      {
        _id: '660000000000000000000502',
        importStatus: 'IMPORTED',
        postImportStatus: 'COMPLETED',
        orderId: '660000000000000000000302',
        orderItemId: '660000000000000000000402',
      },
      {
        _id: '660000000000000000000503',
        importStatus: 'FAILED',
        postImportStatus: 'PENDING',
      },
    ]);
    manualExcelImportService.retryManualImportJob.mockResolvedValue({ replayedRawRecords: 1 });

    const result = await service.retryImportJob('660000000000000000000601');

    expect(manualExcelImportService.retryManualImportJob).toHaveBeenCalledWith(expect.objectContaining({
      _id: '660000000000000000000601',
    }));
    expect(postImportMappingQueue.enqueuePostImportMappingJob).toHaveBeenCalledWith(expect.objectContaining({
      importJobId: '660000000000000000000601',
      rawRecordId: '660000000000000000000501',
      orderItemId: '660000000000000000000401',
      source: 'EXTERNAL_ORDER_IMPORT',
    }));
    expect(result).toMatchObject({
      jobId: '660000000000000000000601',
      replayedRawRecords: 1,
      requeuedPostImportJobs: 1,
      skippedCompletedRecords: 1,
    });
  });
});
