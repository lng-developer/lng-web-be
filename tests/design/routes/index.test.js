const http = require('http');
const express = require('express');
const designRouter = require('../../../src/modules/design/routes');
const errorHandler = require('../../../src/middlewares/errorHandler');
const service = require('../../../src/modules/design/services/designTask.service');
const scoreService = require('../../../src/modules/design/services/designSubmissionScore.service');

jest.mock('../../../src/modules/design/services/designTask.service', () => {
  const service = jest.createMockFromModule('../../../src/modules/design/services/designTask.service');
  service.listSubmissionScores = jest.fn();
  service.listPsdFiles = jest.fn();
  return service;
});
jest.mock('../../../src/modules/design/services/designSubmissionScore.service');

jest.mock('../../../src/modules/auth/public', () => {
  const AppError = require('../../../src/shared/errors/appError');
  const httpStatus = require('../../../src/shared/constants/httpStatus');
  const errorCodes = require('../../../src/shared/constants/errorCodes');

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
          body: responseBody && res.headers['content-type']?.includes('application/json')
            ? JSON.parse(responseBody)
            : responseBody || null,
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
  const scoreId = '660000000000000000510009';

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

  test('GET /tasks/summary requires design read and passes filters', async () => {
    service.summarizeTasks.mockResolvedValue({ total: 0, byStatus: {}, byTaskType: {}, byDesigner: [] });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/tasks/summary',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/tasks/summary?taskType=psd_template&shopId=660000000000000000510003',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.summarizeTasks).toHaveBeenCalledWith({
      taskType: 'PSD_TEMPLATE',
      shopId: '660000000000000000510003',
    }, { permissions: ['DESIGN:READ'] });
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

  test('POST /tasks requires DESIGN:WRITE and validates payload', async () => {
    const invalid = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { listingId, taskType: 'bad' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(service.createTask).not.toHaveBeenCalled();

    const genericPsd = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { listingId, taskType: 'PSD_TEMPLATE', note: 'Need PSD' },
    });
    expect(genericPsd.statusCode).toBe(400);
    expect(service.createTask).not.toHaveBeenCalled();

    const reviewCannotCreate = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:REVIEW'] }) },
      body: { listingId, taskType: 'PSD_TEMPLATE', note: 'Need PSD' },
    });
    expect(reviewCannotCreate.statusCode).toBe(403);
  });

  test('POST variant PSD request calls the only PSD task entrypoint', async () => {
    const variantId = '660000000000000000510009';
    service.createPsdTemplateTaskFromListingVariant.mockResolvedValue({ id: taskId, status: 'REQUESTED' });

    const response = await request(createServer(), {
      method: 'POST',
      path: `/tasks/from-listings/${listingId}/variants/${variantId}/psd-template`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { note: 'Need PSD master' },
    });

    expect(response.statusCode).toBe(201);
    expect(service.createPsdTemplateTaskFromListingVariant).toHaveBeenCalledWith(
      listingId,
      variantId,
      { note: 'Need PSD master' },
      { permissions: ['DESIGN:WRITE'] },
    );
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
        expectedOutputs: ['MOCKUP'],
      },
    });

    expect(clone.statusCode).toBe(201);
    expect(service.createTask).toHaveBeenCalledWith(expect.objectContaining({
      listingId,
      taskType: 'CLONE',
      sourceListingId,
      brief: 'Clone this source',
      expectedOutputs: ['MOCKUP'],
    }), { permissions: ['DESIGN:WRITE'] });

    const clonePsd = await request(createServer(), {
      method: 'POST',
      path: '/tasks',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { listingId, taskType: 'CLONE', sourceListingId, expectedOutputs: ['PSD_TEMPLATE'] },
    });
    expect(clonePsd.statusCode).toBe(400);
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

  test('PATCH /tasks/bulk-assign validates payload and requires DESIGN:WRITE', async () => {
    const secondTaskId = '660000000000000000510013';
    const assignedDesignerId = '660000000000000000510006';
    service.bulkAssignTasks.mockResolvedValue({ assigned: [taskId, secondTaskId], failed: [] });

    const forbidden = await request(createServer(), {
      method: 'PATCH',
      path: '/tasks/bulk-assign',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WORK'] }) },
      body: { taskIds: [taskId, secondTaskId], assignedDesignerId },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await request(createServer(), {
      method: 'PATCH',
      path: '/tasks/bulk-assign',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { taskIds: [taskId, secondTaskId], assignedDesignerId },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.bulkAssignTasks).toHaveBeenCalledWith({
      taskIds: [taskId, secondTaskId],
      assignedDesignerId,
    }, { permissions: ['DESIGN:WRITE'] });
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

  test('GET /score-summary requires read permission, rejects invalid dates, and passes filters', async () => {
    scoreService.summarizeScores.mockResolvedValue({ total: 1 });

    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/score-summary',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const invalidRange = await request(createServer(), {
      method: 'GET',
      path: '/score-summary?dateFrom=2026-07-12&dateTo=2026-07-11',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });
    expect(invalidRange.statusCode).toBe(400);
    expect(scoreService.summarizeScores).not.toHaveBeenCalled();

    const auth = { permissions: ['DESIGN:READ'], accountId: '660000000000000000510006' };
    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/score-summary?designerId=660000000000000000510003&teamId=660000000000000000510004&departmentId=660000000000000000510005&taskType=idea&dateFrom=2026-07-01&dateTo=2026-07-11',
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toEqual({ success: true, data: { total: 1 } });
    expect(scoreService.summarizeScores).toHaveBeenCalledWith({
      designerId: '660000000000000000510003',
      teamId: '660000000000000000510004',
      departmentId: '660000000000000000510005',
      taskType: 'IDEA',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-11T00:00:00.000Z'),
    }, auth);
  });

  test('GET /submission-scores validates and forwards the PSD score filters', async () => {
    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/submission-scores',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    service.listSubmissionScores.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });

    const response = await request(createServer(), {
      method: 'GET',
      path: '/submission-scores?search=shirt&designerId=660000000000000000510006&scoreLevel=standard&scoreStatus=voided&dateFrom=2026-07-01&dateTo=2026-07-31&page=1&limit=20&sortBy=scoredAt&sortOrder=asc',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });

    expect(response.statusCode).toBe(200);
    expect(service.listSubmissionScores).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'shirt',
        designerId: '660000000000000000510006',
        scoreLevel: 'STANDARD',
        scoreStatus: 'VOIDED',
        page: 1,
        limit: 20,
        sortBy: 'scoredAt',
        sortOrder: 'asc',
      }),
      { permissions: ['DESIGN:READ'] },
    );
  });

  test('GET /psd-files rejects an invalid file role and permits Design work access', async () => {
    const forbidden = await request(createServer(), {
      method: 'GET',
      path: '/psd-files',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: [] }) },
    });
    expect(forbidden.statusCode).toBe(403);

    const invalid = await request(createServer(), {
      method: 'GET',
      path: '/psd-files?role=MASTER',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });
    expect(invalid.statusCode).toBe(400);

    const unsupportedMediaSort = await request(createServer(), {
      method: 'GET',
      path: '/psd-files?sortBy=filename',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });
    expect(unsupportedMediaSort.statusCode).toBe(400);

    service.listPsdFiles.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    const allowed = await request(createServer(), {
      method: 'GET',
      path: '/psd-files?role=approved&taskStatus=approved&page=1&limit=20',
      headers: {
        'X-Auth-Context': JSON.stringify({
          permissions: ['DESIGN:WORK'],
          accountId: '660000000000000000510006',
        }),
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.listPsdFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'APPROVED',
        taskStatus: 'APPROVED',
        page: 1,
        limit: 20,
      }),
      expect.objectContaining({ permissions: ['DESIGN:WORK'] }),
    );
  });

  test('PSD workspace list routes do not widen score mutation permissions', async () => {
    const override = await request(createServer(), {
      method: 'PATCH',
      path: `/submission-scores/${scoreId}/override`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
      body: { points: 2, overrideReason: 'Correction' },
    });

    expect(override.statusCode).toBe(403);
  });

  test('PATCH score override requires review permission, validates payload, and calls score service', async () => {
    const forbidden = await request(createServer(), {
      method: 'PATCH',
      path: `/submission-scores/${scoreId}/override`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WORK'] }) },
      body: { points: 3, overrideReason: 'Corrected result' },
    });
    expect(forbidden.statusCode).toBe(403);

    const invalid = await request(createServer(), {
      method: 'PATCH',
      path: `/submission-scores/${scoreId}/override`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:REVIEW'] }) },
      body: { points: -1, scoreLevel: 'INVALID', overrideReason: 'x' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(scoreService.overrideSubmissionScore).not.toHaveBeenCalled();

    const invalidScoreId = await request(createServer(), {
      method: 'PATCH',
      path: '/submission-scores/not-an-id/override',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:REVIEW'] }) },
      body: { points: 3, overrideReason: 'x' },
    });
    expect(invalidScoreId.statusCode).toBe(400);
    expect(scoreService.overrideSubmissionScore).not.toHaveBeenCalled();

    scoreService.overrideSubmissionScore.mockResolvedValue({ id: scoreId, finalPoints: 4 });
    const auth = { permissions: ['DESIGN:REVIEW'], accountId: '660000000000000000510006' };
    const allowed = await request(createServer(), {
      method: 'PATCH',
      path: `/submission-scores/${scoreId}/override`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
      body: { points: 4, scoreLevel: 'hard', overrideReason: '  Adjusted after review  ' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toEqual({ success: true, data: { id: scoreId, finalPoints: 4 } });
    expect(scoreService.overrideSubmissionScore).toHaveBeenCalledWith(scoreId, {
      points: 4,
      scoreLevel: 'HARD',
      overrideReason: 'Adjusted after review',
    }, auth);
  });

  test('PATCH score void requires review permission, validates params and body, and calls score service', async () => {
    const forbidden = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/submissions/${assetId}/assets/${assetId}/score/void`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WORK'] }) },
      body: { voidReason: 'Duplicated submission' },
    });
    expect(forbidden.statusCode).toBe(403);

    const readOnly = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/submissions/${assetId}/assets/${assetId}/score/void`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
      body: { voidReason: 'Duplicated submission' },
    });
    expect(readOnly.statusCode).toBe(403);

    const invalidTask = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/not-an-id/submissions/${assetId}/assets/${assetId}/score/void`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:REVIEW'] }) },
      body: { voidReason: 'x' },
    });
    expect(invalidTask.statusCode).toBe(400);
    expect(scoreService.voidSubmissionScore).not.toHaveBeenCalled();

    const invalidSubmission = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/submissions/not-an-id/assets/${assetId}/score/void`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:REVIEW'] }) },
      body: { voidReason: 'x' },
    });
    expect(invalidSubmission.statusCode).toBe(400);
    expect(scoreService.voidSubmissionScore).not.toHaveBeenCalled();

    scoreService.voidSubmissionScore.mockResolvedValue({ taskId, submissionId: assetId, status: 'VOIDED' });
    const auth = { permissions: ['DESIGN:REVIEW'], accountId: '660000000000000000510006' };
    const allowed = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/submissions/${assetId}/assets/${assetId}/score/void`,
      headers: { 'X-Auth-Context': JSON.stringify(auth) },
      body: { voidReason: '  Duplicate score  ' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toEqual({
      success: true,
      data: { taskId, submissionId: assetId, status: 'VOIDED' },
    });
    expect(scoreService.voidSubmissionScore).toHaveBeenCalledWith(taskId, assetId, assetId, {
      voidReason: 'Duplicate score',
    }, auth);
  });

  test('score routes are registered before the dynamic task route', () => {
    const routeIndexes = new Map(designRouter.stack
      .map((layer, index) => [layer.route?.path, index])
      .filter(([path]) => path));
    const dynamicTaskIndex = routeIndexes.get('/tasks/:taskId');

    expect(routeIndexes.get('/score-summary')).toBeLessThan(dynamicTaskIndex);
    expect(routeIndexes.get('/submission-scores')).toBeLessThan(dynamicTaskIndex);
    expect(routeIndexes.get('/psd-files')).toBeLessThan(dynamicTaskIndex);
    expect(routeIndexes.get('/submission-scores/:scoreId/override')).toBeLessThan(dynamicTaskIndex);
    expect(routeIndexes.get('/tasks/:taskId/submissions/:submissionId/assets/:assetId/score/void')).toBeLessThan(dynamicTaskIndex);
  });
});
