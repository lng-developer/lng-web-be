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
      path: '/tasks?taskType=psd_template&status=open&page=1&limit=20',
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:READ'] }) },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.listTasks).toHaveBeenCalledWith({
      taskType: 'PSD_TEMPLATE',
      status: 'OPEN',
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
    expect(service.createTask).toHaveBeenCalledWith({
      listingId,
      taskType: 'PSD_TEMPLATE',
      note: 'Need PSD',
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

    const approve = await request(createServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/approve`,
      headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['DESIGN:WRITE'] }) },
      body: { approvedAssetId: assetId },
    });
    expect(approve.statusCode).toBe(200);
    expect(service.approveTask).toHaveBeenCalledWith(taskId, { approvedAssetId: assetId }, {
      permissions: ['DESIGN:WRITE'],
    });
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
});
