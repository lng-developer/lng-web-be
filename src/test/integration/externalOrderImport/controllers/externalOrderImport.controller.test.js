jest.mock('../../../../modules/integration/externalOrderImport/services/externalOrderImport.service', () => ({
  importFromManualExcel: jest.fn(),
  importFromEtsySoldOrderItems: jest.fn(),
  getImportJob: jest.fn(),
  listImportJobs: jest.fn(),
  listImportJobIssues: jest.fn(),
  listImportJobRawRecords: jest.fn(),
  listIssues: jest.fn(),
  retryImportJob: jest.fn(),
  updateIssueStatus: jest.fn(),
}));

const service = require('../../../../modules/integration/externalOrderImport/services/externalOrderImport.service');
const controller = require('../../../../modules/integration/externalOrderImport/controllers/externalOrderImport.controller');

describe('externalOrderImport.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists import jobs with validated status and date filters', async () => {
    service.listImportJobs.mockResolvedValue({
      items: [{ _id: '660000000000000000000601', status: 'FAILED' }],
      total: 1,
      page: 2,
      limit: 10,
    });
    const req = {
      auth: { permissions: ['ORDERS:READ'] },
      query: {
        page: '2',
        limit: '10',
        status: 'failed',
        dateFrom: '2026-07-01T00:00:00.000Z',
        dateTo: '2026-07-31T23:59:59.999Z',
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await controller.listImportJobs(req, res);

    expect(service.listImportJobs).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      status: 'FAILED',
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-31T23:59:59.999Z',
    }, req.auth);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({
      items: [{ id: '660000000000000000000601', status: 'FAILED' }],
      pagination: { total: 1, page: 2, limit: 10 },
    });
  });

  test('rejects a reversed import-job date range', async () => {
    const req = {
      auth: { permissions: ['ORDERS:READ'] },
      query: {
        dateFrom: '2026-07-31T00:00:00.000Z',
        dateTo: '2026-07-01T00:00:00.000Z',
      },
    };

    await expect(controller.listImportJobs(req, { status: jest.fn(), json: jest.fn() }))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(service.listImportJobs).not.toHaveBeenCalled();
  });
  test('imports manual excel from multipart file buffer', async () => {
    service.importFromManualExcel.mockResolvedValue({
      jobId: '660000000000000000000601',
      status: 'COMPLETED',
    });

    const req = {
      auth: { accountId: '660000000000000000000801' },
      body: {
        shopId: '660000000000000000000201',
        marketplaceCode: 'AMAZON_US',
      },
      file: {
        originalname: 'amazon-orders.tsv',
        mimetype: 'text/tab-separated-values',
        buffer: Buffer.from('order-id\torder-item-id\n113-1\tITEM-1'),
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.importManualExcel(req, res);

    expect(service.importFromManualExcel).toHaveBeenCalledWith(
      expect.objectContaining({
        originalFilename: 'amazon-orders.tsv',
        mimeType: 'text/tab-separated-values',
        buffer: req.file.buffer,
        shopId: req.body.shopId,
        marketplaceCode: req.body.marketplaceCode,
        triggeredBy: req.auth.accountId,
      }),
      req.auth,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('imports Etsy sold order items from multipart file buffer', async () => {
    service.importFromEtsySoldOrderItems.mockResolvedValue({
      jobId: '660000000000000000000601',
      status: 'COMPLETED',
    });

    const req = {
      auth: { accountId: '660000000000000000000801' },
      body: {
        shopId: '660000000000000000000201',
        marketplaceCode: 'ETSY_US',
      },
      file: {
        originalname: 'EtsySoldOrderItems2026-6.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from('Order ID,Transaction ID\n4101302696,5121748428'),
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.importEtsySoldOrderItems(req, res);

    expect(service.importFromEtsySoldOrderItems).toHaveBeenCalledWith(
      expect.objectContaining({
        originalFilename: 'EtsySoldOrderItems2026-6.csv',
        mimeType: 'text/csv',
        buffer: req.file.buffer,
        shopId: req.body.shopId,
        marketplaceCode: req.body.marketplaceCode,
        triggeredBy: req.auth.accountId,
      }),
      req.auth,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('lists issues with filters', async () => {
    service.listIssues.mockResolvedValue({
      items: [{ _id: '660000000000000000000901', issueType: 'CUSTOMIZATION_MISMATCH' }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const req = {
      auth: { accountId: '660000000000000000000801' },
      query: {
        shopId: '660000000000000000000201',
        externalOrderId: '114-1',
        issueType: 'CUSTOMIZATION_MISMATCH',
        status: 'OPEN',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.listIssues(req, res);

    expect(service.listIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: '660000000000000000000201',
        externalOrderId: '114-1',
        issueType: 'CUSTOMIZATION_MISMATCH',
        status: 'OPEN',
      }),
      req.auth,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.items[0].issueType).toBe('CUSTOMIZATION_MISMATCH');
  });

  test('gets an import job with the request auth context', async () => {
    service.getImportJob.mockResolvedValue({
      _id: '660000000000000000000601',
      shopId: '660000000000000000000201',
      status: 'COMPLETED',
      summary: {},
    });
    const req = {
      auth: { accountId: '660000000000000000000801' },
      params: { jobId: '660000000000000000000601' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.getImportJob(req, res);

    expect(service.getImportJob).toHaveBeenCalledWith('660000000000000000000601', req.auth);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('lists import job issues with the request auth context', async () => {
    service.listImportJobIssues.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    const req = {
      auth: { accountId: '660000000000000000000801' },
      params: { jobId: '660000000000000000000601' },
      query: {},
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.listImportJobIssues(req, res);

    expect(service.listImportJobIssues).toHaveBeenCalledWith(
      '660000000000000000000601',
      {},
      req.auth,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('lists raw records with post-import status filter', async () => {
    service.listImportJobRawRecords.mockResolvedValue({
      items: [{
        _id: '660000000000000000000501',
        postImportStatus: 'FAILED',
        postImportErrorCode: 'POST_IMPORT_QUEUE_UNAVAILABLE',
      }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const req = {
      auth: { accountId: '660000000000000000000801' },
      params: { jobId: '660000000000000000000601' },
      query: { postImportStatus: 'FAILED' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.listImportJobRawRecords(req, res);

    expect(service.listImportJobRawRecords).toHaveBeenCalledWith(
      '660000000000000000000601',
      expect.objectContaining({ postImportStatus: 'FAILED' }),
      req.auth,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.items[0]).toMatchObject({
      id: '660000000000000000000501',
      postImportStatus: 'FAILED',
      postImportErrorCode: 'POST_IMPORT_QUEUE_UNAVAILABLE',
    });
  });

  test('retries import job', async () => {
    service.retryImportJob.mockResolvedValue({
      jobId: '660000000000000000000601',
      replayedRawRecords: 0,
      requeuedPostImportJobs: 2,
      skippedCompletedRecords: 1,
    });

    const req = {
      auth: { accountId: '660000000000000000000801' },
      params: { jobId: '660000000000000000000601' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.retryImportJob(req, res);

    expect(service.retryImportJob).toHaveBeenCalledWith('660000000000000000000601', req.auth);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({
      requeuedPostImportJobs: 2,
      skippedCompletedRecords: 1,
    });
  });

  test('updates an issue with a validated terminal status and trimmed note', async () => {
    service.updateIssueStatus.mockResolvedValue({
      _id: '660000000000000000000901',
      status: 'RESOLVED',
      resolutionNote: 'Corrected source row',
    });
    const req = {
      auth: { accountId: '660000000000000000000801' },
      params: { issueId: '660000000000000000000901' },
      body: { status: 'resolved', note: '  Corrected source row  ' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await controller.updateIssueStatus(req, res);

    expect(service.updateIssueStatus).toHaveBeenCalledWith(
      req.params.issueId,
      { status: 'RESOLVED', note: 'Corrected source row' },
      req.auth,
    );
    expect(res.json.mock.calls[0][0].data).toMatchObject({
      id: req.params.issueId,
      status: 'RESOLVED',
      resolutionNote: 'Corrected source row',
    });
  });
});
