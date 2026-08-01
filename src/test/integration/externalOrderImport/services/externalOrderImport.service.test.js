jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository', () => ({
  findById: jest.fn(),
  findIds: jest.fn(),
  findShopIdsByIds: jest.fn(),
  list: jest.fn(),
  updateCounters: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository', () => ({
  findById: jest.fn(),
  list: jest.fn(),
  listByJob: jest.fn(),
  transitionOpen: jest.fn(),
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
    jobRepository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    jobRepository.findShopIdsByIds.mockResolvedValue([]);
    issueRepository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    issueRepository.listByJob.mockResolvedValue({ items: [], total: 0, page: 1, limit: 1 });
    rawRecordRepository.listAllByJob.mockResolvedValue([]);
    manualExcelImportService.retryManualImportJob.mockResolvedValue({ replayedRawRecords: 0 });
    postImportMappingQueue.enqueuePostImportMappingJob.mockResolvedValue({ queued: true });
    orderPublic.findItemById.mockResolvedValue(null);
    mappingPublic.listFulfillmentPlansByOrderItemIds.mockResolvedValue([]);
    productionPublic.listTaskSummariesByOrderItemIds.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
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

  test('lists jobs without shop constraints for a global reader', async () => {
    const params = {
      status: 'FAILED',
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-31T23:59:59.999Z',
      page: 1,
      limit: 20,
    };

    await service.listImportJobs(params, { permissions: ['ORDERS:READ'] });

    expect(jobRepository.list).toHaveBeenCalledWith(params);
  });

  test('enriches a global issue page with shop ids in one bulk job lookup', async () => {
    issueRepository.list.mockResolvedValue({
      items: [
        { _id: '660000000000000000000901', importJobId: '660000000000000000000601' },
        { _id: '660000000000000000000902', importJobId: '660000000000000000000602' },
      ],
      total: 2,
      page: 1,
      limit: 20,
    });
    jobRepository.findShopIdsByIds.mockResolvedValue([
      { _id: '660000000000000000000601', shopId },
      { _id: '660000000000000000000602', shopId: otherShopId },
    ]);

    const result = await service.listIssues(
      { status: 'OPEN', page: 1, limit: 20 },
      { permissions: ['ORDERS:READ'] },
    );

    expect(jobRepository.findShopIdsByIds).toHaveBeenCalledWith([
      '660000000000000000000601',
      '660000000000000000000602',
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({ shopId }),
      expect.objectContaining({ shopId: otherShopId }),
    ]);
  });

  test('limits job listing to shops readable through scoped write access', async () => {
    await service.listImportJobs(
      { source: 'MANUAL_EXCEL', page: 2, limit: 10 },
      { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }] },
    );

    expect(jobRepository.list).toHaveBeenCalledWith({
      source: 'MANUAL_EXCEL',
      page: 2,
      limit: 10,
      shopIds: [shopId],
    });
  });

  test('returns an empty job page without querying for an unauthorized shop', async () => {
    const result = await service.listImportJobs(
      { shopId: otherShopId, page: 2, limit: 10 },
      { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] }] },
    );

    expect(result).toEqual({ items: [], total: 0, page: 2, limit: 10 });
    expect(jobRepository.list).not.toHaveBeenCalled();
  });

  test('returns an empty job page when the caller has no readable shops', async () => {
    const result = await service.listImportJobs({ page: 1, limit: 20 }, { scopes: [] });

    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(jobRepository.list).not.toHaveBeenCalled();
  });

  test('resolves an open issue after authorizing its owning job', async () => {
    const issue = {
      _id: '660000000000000000000901',
      importJobId: '660000000000000000000601',
      status: 'OPEN',
    };
    const resolved = {
      ...issue,
      status: 'RESOLVED',
      resolutionNote: 'Corrected source row',
      resolvedBy: '660000000000000000000801',
      resolvedAt: new Date('2026-07-31T08:00:00.000Z'),
    };
    issueRepository.findById.mockResolvedValue(issue);
    issueRepository.transitionOpen.mockResolvedValue(resolved);
    const auth = { accountId: '660000000000000000000801', permissions: ['ORDERS:WRITE'] };

    const result = await service.updateIssueStatus(issue._id, {
      status: 'RESOLVED',
      note: 'Corrected source row',
    }, auth);

    expect(jobRepository.findById).toHaveBeenCalledWith(issue.importJobId);
    expect(issueRepository.transitionOpen).toHaveBeenCalledWith(issue._id, expect.objectContaining({
      status: 'RESOLVED',
      resolutionNote: 'Corrected source row',
      resolvedBy: auth.accountId,
      resolvedAt: expect.any(Date),
    }));
    expect(result).toBe(resolved);
  });

  test('rejects a terminal issue transition with a conflict', async () => {
    issueRepository.findById.mockResolvedValue({
      _id: '660000000000000000000901',
      importJobId: '660000000000000000000601',
      status: 'RESOLVED',
    });

    await expect(service.updateIssueStatus(
      '660000000000000000000901',
      { status: 'IGNORED', note: 'Duplicate report' },
      { accountId: '660000000000000000000801', permissions: ['ORDERS:WRITE'] },
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });

    expect(issueRepository.transitionOpen).not.toHaveBeenCalled();
  });

  test('does not mutate an issue outside the caller shop scope', async () => {
    issueRepository.findById.mockResolvedValue({
      _id: '660000000000000000000901',
      importJobId: '660000000000000000000601',
      status: 'OPEN',
    });
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.updateIssueStatus(
      '660000000000000000000901',
      { status: 'IGNORED', note: 'Not actionable' },
      { accountId: '660000000000000000000801', scopes: [] },
    )).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

    expect(issueRepository.transitionOpen).not.toHaveBeenCalled();
  });

  test('returns not found for a missing issue', async () => {
    issueRepository.findById.mockResolvedValue(null);

    await expect(service.updateIssueStatus(
      '660000000000000000000901',
      { status: 'RESOLVED', note: 'Corrected' },
      { accountId: '660000000000000000000801', permissions: ['ORDERS:WRITE'] },
    )).rejects.toMatchObject({ statusCode: 404, code: 'RESOURCE_NOT_FOUND' });
  });

  test('returns a conflict when another writer closes the issue first', async () => {
    issueRepository.findById.mockResolvedValue({
      _id: '660000000000000000000901',
      importJobId: '660000000000000000000601',
      status: 'OPEN',
    });
    issueRepository.transitionOpen.mockResolvedValue(null);

    await expect(service.updateIssueStatus(
      '660000000000000000000901',
      { status: 'RESOLVED', note: 'Corrected' },
      { accountId: '660000000000000000000801', permissions: ['ORDERS:WRITE'] },
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
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

  test('limits a global reader issue list to an explicitly selected shop', async () => {
    jobRepository.findIds.mockResolvedValue(['660000000000000000000601']);

    await service.listIssues(
      { shopId, status: 'OPEN', page: 1, limit: 20 },
      { permissions: ['ORDERS:READ'] },
    );

    expect(jobRepository.findIds).toHaveBeenCalledWith({ shopId });
    expect(issueRepository.list).toHaveBeenCalledWith({
      status: 'OPEN',
      page: 1,
      limit: 20,
      importJobIds: ['660000000000000000000601'],
    });
  });

  test('returns an empty issue page for a shop outside the caller read scope', async () => {
    const result = await service.listIssues(
      { shopId: otherShopId, page: 2, limit: 10 },
      { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] }] },
    );

    expect(result).toEqual({ items: [], total: 0, page: 2, limit: 10 });
    expect(jobRepository.findIds).not.toHaveBeenCalled();
    expect(issueRepository.list).not.toHaveBeenCalled();
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
    const beforeRetry = [
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
    ];
    const afterRetry = beforeRetry.map((record) => (
      record._id === '660000000000000000000503'
        ? { ...record, normalizeStatus: 'NORMALIZED', importStatus: 'IMPORTED' }
        : { normalizeStatus: 'NORMALIZED', ...record }
    ));
    rawRecordRepository.listAllByJob.mockResolvedValue(afterRetry);
    manualExcelImportService.retryManualImportJob.mockResolvedValue({ replayedRawRecords: 1 });

    const result = await service.retryImportJob('660000000000000000000601', { system: true, source: 'TEST' });

    expect(manualExcelImportService.retryManualImportJob).toHaveBeenCalledWith(expect.objectContaining({
      _id: '660000000000000000000601',
    }));
    expect(jobRepository.updateStatus.mock.calls[0]).toEqual([
      '660000000000000000000601',
      'IMPORTING',
      expect.objectContaining({
        startedAt: expect.any(Date),
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      }),
    ]);
    expect(jobRepository.updateCounters).toHaveBeenCalledWith(
      '660000000000000000000601',
      {
        totalRecords: 4,
        parsedCount: 4,
        importedCount: 4,
        skippedCount: 0,
        failedCount: 0,
      },
    );
    expect(jobRepository.updateStatus).toHaveBeenLastCalledWith(
      '660000000000000000000601',
      'COMPLETED',
      { finishedAt: expect.any(Date) },
    );
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
      status: 'COMPLETED',
    });
  });

  test('retryImportJob finalizes failed with fresh counters when replay throws', async () => {
    rawRecordRepository.listAllByJob.mockResolvedValue([
      {
        _id: '660000000000000000000503',
        normalizeStatus: 'NORMALIZED',
        importStatus: 'FAILED',
        postImportStatus: 'PENDING',
      },
    ]);
    manualExcelImportService.retryManualImportJob.mockRejectedValue(
      Object.assign(new Error('Replay failed'), { code: 'REPLAY_FAILED' }),
    );

    await expect(service.retryImportJob(
      '660000000000000000000601',
      { system: true, source: 'TEST' },
    )).rejects.toThrow('Replay failed');

    expect(jobRepository.updateCounters).toHaveBeenCalledWith(
      '660000000000000000000601',
      {
        totalRecords: 1,
        parsedCount: 1,
        importedCount: 0,
        skippedCount: 0,
        failedCount: 1,
      },
    );
    expect(jobRepository.updateStatus).toHaveBeenLastCalledWith(
      '660000000000000000000601',
      'FAILED',
      expect.objectContaining({
        errorCode: 'REPLAY_FAILED',
        errorMessage: 'Replay failed',
        finishedAt: expect.any(Date),
      }),
    );
  });

  test('retryImportJob remains failed when a failed source has no persisted rows to replay', async () => {
    jobRepository.findById.mockResolvedValue({
      _id: '660000000000000000000601',
      shopId,
      status: 'FAILED',
      errorCode: 'UNSUPPORTED_FILE_TYPE',
      errorMessage: 'Unsupported file type',
    });
    rawRecordRepository.listAllByJob.mockResolvedValue([]);

    const result = await service.retryImportJob(
      '660000000000000000000601',
      { system: true, source: 'TEST' },
    );

    expect(jobRepository.updateStatus.mock.calls[0][2]).toMatchObject({
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
    });
    expect(jobRepository.updateStatus).toHaveBeenLastCalledWith(
      '660000000000000000000601',
      'FAILED',
      expect.objectContaining({
        errorCode: 'NO_RETRYABLE_RECORDS',
        finishedAt: expect.any(Date),
      }),
    );
    expect(result.status).toBe('FAILED');
  });

  test('does not requeue a processing record while its lease is active', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T06:00:00.000Z'));
    rawRecordRepository.listAllByJob.mockResolvedValue([{
      _id: '660000000000000000000505',
      importStatus: 'IMPORTED',
      postImportStatus: 'PROCESSING',
      postImportStartedAt: new Date('2026-07-31T05:40:00.000Z'),
      postImportLeaseExpiresAt: new Date('2026-07-31T06:05:00.000Z'),
      orderItemId: '660000000000000000000405',
    }]);

    const result = await service.retryImportJob(
      '660000000000000000000601',
      { system: true, source: 'TEST' },
    );

    expect(postImportMappingQueue.enqueuePostImportMappingJob).not.toHaveBeenCalled();
    expect(result.requeuedPostImportJobs).toBe(0);
  });
});
