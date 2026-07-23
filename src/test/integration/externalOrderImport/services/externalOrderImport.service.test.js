jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository', () => ({
  findById: jest.fn(),
  findIds: jest.fn(),
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

jest.mock('../../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  isSuperAdmin: jest.fn(),
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
const authPublic = require('../../../../modules/auth/public');
const orderPublic = require('../../../../modules/order/public');
const mappingPublic = require('../../../../modules/mapping/public');
const productionPublic = require('../../../../modules/production/public');
const service = require('../../../../modules/integration/externalOrderImport/services/externalOrderImport.service');

describe('externalOrderImport.service issue workflow', () => {
  const shopId = '660000000000000000000201';
  const otherShopId = '660000000000000000000202';

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    authPublic.isSuperAdmin.mockReturnValue(false);
    jobRepository.findById.mockResolvedValue({ _id: '660000000000000000000601', shopId, status: 'COMPLETED' });
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
    }, { permissions: ['ORDERS:READ'] });

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

  test('limits issue listing to jobs from readable shops', async () => {
    jobRepository.findIds.mockResolvedValue([
      '660000000000000000000601',
      '660000000000000000000602',
    ]);
    const auth = {
      scopes: [{
        scopeType: 'shop',
        scopeId: shopId,
        permissions: ['ORDERS:READ'],
      }],
    };

    await service.listIssues({ status: 'OPEN', page: 1, limit: 20 }, auth);

    expect(jobRepository.findIds).toHaveBeenCalledWith({ shopIds: [shopId] });
    expect(issueRepository.list).toHaveBeenCalledWith(expect.objectContaining({
      importJobIds: [
        '660000000000000000000601',
        '660000000000000000000602',
      ],
      status: 'OPEN',
    }));
  });

  test('returns an empty page when scoped caller has no readable jobs', async () => {
    jobRepository.findIds.mockResolvedValue([]);

    const result = await service.listIssues(
      { page: 2, limit: 10 },
      { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] }] },
    );

    expect(result).toEqual({ items: [], total: 0, page: 2, limit: 10 });
    expect(issueRepository.list).not.toHaveBeenCalled();
  });

  test('keeps the unscoped issue list for global readers', async () => {
    await service.listIssues(
      { status: 'OPEN' },
      { permissions: ['ORDERS:READ'] },
    );

    expect(jobRepository.findIds).not.toHaveBeenCalled();
    expect(issueRepository.list).toHaveBeenCalledWith({ status: 'OPEN' });
  });

  test('keeps the unscoped issue list for a SUPER_ADMIN', async () => {
    authPublic.isSuperAdmin.mockImplementation((authContext) => (
      (authContext.roles || []).includes('SUPER_ADMIN')
    ));

    await service.listIssues(
      { status: 'OPEN' },
      { roles: ['SUPER_ADMIN'], permissions: [], scopes: [] },
    );

    expect(jobRepository.findIds).not.toHaveBeenCalled();
    expect(issueRepository.list).toHaveBeenCalledWith({ status: 'OPEN' });
  });

  test('treats scoped ORDERS:WRITE as readable for issue lists', async () => {
    jobRepository.findIds.mockResolvedValue(['660000000000000000000601']);

    await service.listIssues(
      { status: 'OPEN' },
      { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }] },
    );

    expect(jobRepository.findIds).toHaveBeenCalledWith({ shopIds: [shopId] });
    expect(issueRepository.list).toHaveBeenCalledWith({
      status: 'OPEN',
      importJobIds: ['660000000000000000000601'],
    });
  });

  test('returns an empty page for an explicit foreign import job', async () => {
    jobRepository.findIds.mockResolvedValue(['660000000000000000000601']);

    const result = await service.listIssues(
      { importJobId: '660000000000000000000602', page: 2, limit: 10 },
      { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] }] },
    );

    expect(result).toEqual({ items: [], total: 0, page: 2, limit: 10 });
    expect(issueRepository.list).not.toHaveBeenCalled();
  });

  test('rejects creating an import for a shop outside the caller write scope', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.importFromManualExcel(
      { shopId: otherShopId, buffer: Buffer.from('x') },
      { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }] },
    )).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });

    expect(manualExcelImportService.importManualExcelOrderReport).not.toHaveBeenCalled();
  });

  test('rejects reading and retrying another shops import job', async () => {
    authPublic.canAccessScope.mockReturnValue(false);
    const auth = { scopes: [{ scopeType: 'shop', scopeId: otherShopId, permissions: ['ORDERS:READ'] }] };

    await expect(service.getImportJob('660000000000000000000601', auth))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    await expect(service.retryImportJob('660000000000000000000601', auth))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

    expect(rawRecordRepository.listAllByJob).not.toHaveBeenCalled();
    expect(manualExcelImportService.retryManualImportJob).not.toHaveBeenCalled();
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

    const job = await service.getImportJob('660000000000000000000601', { system: true, source: 'TEST' });

    expect(job.summary).toMatchObject({
      rawRecords: { total: 2, normalized: 2, imported: 2 },
      postImport: { completed: 1, failed: 1 },
      orderItems: { total: 2, linkedListing: 1, fulfillmentReady: 1, needProduction: 1 },
      plans: { ready: 1, blocked: 1 },
      productionTasks: { total: 1, blocked: 1, needScale: 1 },
    });
  });

  test('retryImportJob replays non-imported rows and requeues failed or stale queued post-import rows', async () => {
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
        _id: '660000000000000000000504',
        importJobId: '660000000000000000000601',
        importStatus: 'IMPORTED',
        postImportStatus: 'QUEUED',
        postImportQueuedAt: new Date(Date.now() - 11 * 60 * 1000),
        orderId: '660000000000000000000303',
        orderItemId: '660000000000000000000403',
        externalOrderId: '113-2',
        externalItemId: 'ITEM-2',
      },
      {
        _id: '660000000000000000000503',
        importStatus: 'FAILED',
        postImportStatus: 'PENDING',
      },
    ]);
    manualExcelImportService.retryManualImportJob.mockResolvedValue({ replayedRawRecords: 1 });

    const result = await service.retryImportJob('660000000000000000000601', { system: true, source: 'TEST' });

    expect(manualExcelImportService.retryManualImportJob).toHaveBeenCalledWith(expect.objectContaining({
      _id: '660000000000000000000601',
    }));
    expect(postImportMappingQueue.enqueuePostImportMappingJob).toHaveBeenCalledWith(expect.objectContaining({
      importJobId: '660000000000000000000601',
      rawRecordId: '660000000000000000000501',
      orderItemId: '660000000000000000000401',
      source: 'EXTERNAL_ORDER_IMPORT',
    }));
    expect(postImportMappingQueue.enqueuePostImportMappingJob).toHaveBeenCalledWith(expect.objectContaining({
      rawRecordId: '660000000000000000000504',
      orderItemId: '660000000000000000000403',
    }));
    expect(result).toMatchObject({
      jobId: '660000000000000000000601',
      replayedRawRecords: 1,
      requeuedPostImportJobs: 2,
      skippedCompletedRecords: 1,
    });
  });
});
