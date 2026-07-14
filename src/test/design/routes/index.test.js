const http = require('http');
const express = require('express');
const designRouter = require('../../../modules/design/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const service = require('../../../modules/design/services/designTask.service');

jest.mock('../../../modules/design/services/designTask.service');

jest.mock('../../../modules/auth/public', () => {
  const AppError = require('../../../shared/errors/appError');
  const httpStatus = require('../../../shared/constants/httpStatus');
  const errorCodes = require('../../../shared/constants/errorCodes');

  return {
    authenticate: (req, res, next) => {
      req.auth = req.headers['x-auth-context']
        ? JSON.parse(req.headers['x-auth-context'])
        : { permissions: [] };
      next();
    },
    authorizeAnyPermission: (...permissions) => (req, res, next) => {
      if (permissions.some((permission) => (req.auth.permissions || []).includes(permission))) return next();
      return next(new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR));
    },
  };
});

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(designRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, {
  method, path, headers = {}, body,
}) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => server.close(() => resolve({
          statusCode: res.statusCode,
          body: responseBody ? JSON.parse(responseBody) : null,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('design routes', () => {
  const taskId = '660000000000000000510001';
  const listingId = '660000000000000000510002';
  const assetId = '660000000000000000510007';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /tasks requires DESIGN:READ and passes query', async () => {
    service.listTasks.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/tasks?taskType=psd_template&status=requested&page=1&limit=20&search=B0TEST&sellerId=660000000000000000510003&dateFrom=2026-07-01&dateTo=2026-07-11&priority=high&psdStatus=missing&sortBy=createdAt&sortOrder=asc',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.listTasks).toHaveBeenCalledWith({
      taskType: 'PSD_TEMPLATE',
      status: 'REQUESTED',
      page: 1,
      limit: 20,
      search: 'B0TEST',
      shopId: '660000000000000000510003',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-11T00:00:00.000Z'),
      priority: 'HIGH',
      psdStatus: 'MISSING',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    }, { permissions: ['DESIGN:READ'] });

    service.listTasks.mockClear();
    const own = await request(createServer(), {
      method: 'GET',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WORK'], accountId: '660000000000000000510006' }) },
    });
    expect(own.statusCode).toBe(200);
    expect(service.listTasks).toHaveBeenCalledWith({}, {
      permissions: ['DESIGN:WORK'],
      accountId: '660000000000000000510006',
    });
  });

  test('GET /tasks/workload requires design read or work permission', async () => {
    service.getWorkload.mockResolvedValue({ totals: {}, byDesigner: [] });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/tasks/workload',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/tasks/workload?taskType=idea&dateFrom=2026-07-01&dateTo=2026-07-11&search=SKU-1&sellerId=660000000000000000510003&priority=urgent&psdStatus=missing&sortBy=status&sortOrder=desc',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WORK'], accountId: '660000000000000000510006' }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.getWorkload).toHaveBeenCalledWith({
      taskType: 'IDEA',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-11T00:00:00.000Z'),
      search: 'SKU-1',
      shopId: '660000000000000000510003',
      priority: 'URGENT',
      psdStatus: 'MISSING',
      sortBy: 'status',
      sortOrder: 'desc',
    }, {
      permissions: ['DESIGN:WORK'],
      accountId: '660000000000000000510006',
    });
  });

  test('GET /assignees returns assignable designers for task type', async () => {
    service.getAssignees.mockResolvedValue({
      items: [{ id: '660000000000000000510006', fullName: 'Designer', avatarUrl: null, activeTaskCount: 2 }],
    });

    const response = await request(createServer(), {
      method: 'GET',
      path: '/assignees?taskType=psd_template',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(service.getAssignees).toHaveBeenCalledWith({
      taskType: 'PSD_TEMPLATE',
    }, { permissions: ['DESIGN:READ'] });
  });

  test('GET /tasks/psd-template/candidates returns missing PSD listings without active tasks', async () => {
    service.listPsdTemplateCandidates.mockResolvedValue({
      items: [{ id: listingId, sku: 'SKU-1', hasActivePsdTask: false }],
      pagination: { total: 1, page: 1, limit: 20 },
    });

    const response = await request(createServer(), {
      method: 'GET',
      path: '/tasks/psd-template/candidates?search=SKU&sellerId=660000000000000000510003&page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(service.listPsdTemplateCandidates).toHaveBeenCalledWith({
      search: 'SKU',
      shopId: '660000000000000000510003',
      page: 1,
      limit: 20,
    }, { permissions: ['DESIGN:READ'] });
  });

  test('POST /tasks requires DESIGN:WRITE and validates payload', async () => {
    const invalid = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { listingId, taskType: 'bad' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(service.createTask).not.toHaveBeenCalled();

    service.createTask.mockResolvedValue({ id: taskId, status: 'OPEN' });
    const allowed = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { listingId, taskType: 'PSD_TEMPLATE', note: 'Need PSD' },
    });
    expect(allowed.statusCode).toBe(201);
    expect(service.createTask).toHaveBeenCalledWith(expect.objectContaining({
      listingId,
      taskType: 'PSD_TEMPLATE',
      note: 'Need PSD',
      referenceAssetIds: [],
      expectedOutputs: [],
    }), { permissions: ['DESIGN:WRITE'] });

    const reviewCannotCreate = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:REVIEW'] }) },
      body: { listingId, taskType: 'PSD_TEMPLATE', note: 'Need PSD' },
    });
    expect(reviewCannotCreate.statusCode).toBe(403);
  });

  test('POST /tasks validates IDEA and CLONE payloads', async () => {
    const ideaMissingBrief = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { listingId, taskType: 'IDEA' },
    });
    expect(ideaMissingBrief.statusCode).toBe(400);

    const cloneMissingSource = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { listingId, taskType: 'CLONE' },
    });
    expect(cloneMissingSource.statusCode).toBe(400);

    const sourceListingId = '660000000000000000510012';
    service.createTask.mockResolvedValue({ id: taskId, taskType: 'CLONE', status: 'OPEN' });
    const clone = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: {
        listingId,
        taskType: 'CLONE',
        sourceListingId,
        brief: 'Clone this source',
        expectedOutputs: ['PSD_TEMPLATE'],
      },
    });

    expect(clone.statusCode).toBe(201);
    expect(service.createTask).toHaveBeenCalledWith(expect.objectContaining({
      listingId,
      taskType: 'CLONE',
      sourceListingId,
      brief: 'Clone this source',
      expectedOutputs: ['PSD_TEMPLATE'],
    }), { permissions: ['DESIGN:WRITE'] });
  });

  test('POST /tasks/from-listings/:listingId/psd-template creates PSD helper task', async () => {
    service.createPsdTemplateTaskFromListing.mockResolvedValue({ id: taskId, status: 'OPEN' });

    const response = await request(createServer(), {
      method: 'POST',
      path: `/tasks/from-listings/${listingId}/psd-template`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { note: 'Need PSD master' },
    });

    expect(response.statusCode).toBe(201);
    expect(service.createPsdTemplateTaskFromListing).toHaveBeenCalledWith(listingId, {
      note: 'Need PSD master',
    }, { permissions: ['DESIGN:WRITE'] });
  });

  test('POST /tasks/bulk-create-psd-from-listings validates payload and calls service', async () => {
    service.bulkCreatePsdTasksFromListings.mockResolvedValue({
      checked: 1,
      created: 1,
      existing: 0,
      skipped: 0,
      items: [{ listingId, status: 'CREATED', taskId }],
    });

    const response = await request(createServer(), {
      method: 'POST',
      path: '/tasks/bulk-create-psd-from-listings',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { listingIds: [listingId], note: 'Need PSD master' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.bulkCreatePsdTasksFromListings).toHaveBeenCalledWith({
      listingIds: [listingId],
      limit: 100,
      note: 'Need PSD master',
    }, { permissions: ['DESIGN:WRITE'] });
  });

  test('PATCH submit and approve call service with validated payloads', async () => {
    service.submitTask.mockResolvedValue({ id: taskId, status: 'SUBMITTED' });
    service.approveTask.mockResolvedValue({ id: taskId, status: 'APPROVED' });

    const submit = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/submit`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { submittedAssetIds: [assetId] },
    });
    expect(submit.statusCode).toBe(200);
    expect(service.submitTask).toHaveBeenCalledWith(taskId, { submittedAssetIds: [assetId] }, {
      permissions: ['DESIGN:WRITE'],
    });

    service.submitTask.mockClear();
    const submitOwn = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/submit`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WORK'], accountId: '660000000000000000510006' }) },
      body: { submittedAssetIds: [assetId] },
    });
    expect(submitOwn.statusCode).toBe(200);
    expect(service.submitTask).toHaveBeenCalledWith(taskId, { submittedAssetIds: [assetId] }, {
      permissions: ['DESIGN:WORK'],
      accountId: '660000000000000000510006',
    });

    const approve = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/approve`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { approvedAssetId: assetId, version: 2 },
    });
    expect(approve.statusCode).toBe(200);
    expect(service.approveTask).toHaveBeenCalledWith(taskId, { approvedAssetId: assetId, version: 2 }, {
      permissions: ['DESIGN:WRITE'],
    });

    service.approveTask.mockClear();
    const reviewApprove = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/approve`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:REVIEW'], accountId: '660000000000000000510006' }) },
      body: { approvedAssetId: assetId },
    });
    expect(reviewApprove.statusCode).toBe(200);
    expect(service.approveTask).toHaveBeenCalledWith(taskId, { approvedAssetId: assetId }, {
      permissions: ['DESIGN:REVIEW'],
      accountId: '660000000000000000510006',
    });

    const workApprove = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/approve`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WORK'], accountId: '660000000000000000510006' }) },
      body: { approvedAssetId: assetId },
    });
    expect(workApprove.statusCode).toBe(403);
  });

  test('DESIGN:REVIEW cannot assign tasks without DESIGN:WRITE', async () => {
    const response = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/assign`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:REVIEW'] }) },
      body: { assignedDesignerId: '660000000000000000510006' },
    });

    expect(response.statusCode).toBe(403);
    expect(service.assignTask).not.toHaveBeenCalled();
  });

  test('PATCH reject requires rejectReason', async () => {
    const response = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/reject`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { rejectReason: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.rejectTask).not.toHaveBeenCalled();
  });

  test('submission history routes call service with validated params', async () => {
    const submissionId = '660000000000000000510022';
    service.listSubmissions.mockResolvedValue({ items: [] });
    service.removeSubmission.mockResolvedValue({ id: taskId, status: 'SUBMITTED' });

    const list = await request(createServer(), {
      method: 'GET',
      path: `/tasks/${taskId}/submissions`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });
    expect(list.statusCode).toBe(200);
    expect(service.listSubmissions).toHaveBeenCalledWith(taskId, { permissions: ['DESIGN:READ'] });

    const removed = await request(createServer(), {
      method: 'DELETE',
      path: `/tasks/${taskId}/submissions/${submissionId}`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'], accountId: '660000000000000000510006' }) },
    });
    expect(removed.statusCode).toBe(200);
    expect(service.removeSubmission).toHaveBeenCalledWith(taskId, submissionId, {
      permissions: ['DESIGN:WRITE'],
      accountId: '660000000000000000510006',
    });
  });
});
