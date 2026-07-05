const http = require('http');
const express = require('express');
const productionRouter = require('../../../modules/production/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const service = require('../../../modules/production/services/productionTask.service');

jest.mock('../../../modules/production/services/productionTask.service');

jest.mock('../../../modules/auth/public', () => ({
  authenticate: (req, res, next) => {
    req.auth = { permissions: ['PRODUCTION:READ', 'PRODUCTION:WRITE'], scopes: [] };
    next();
  },
  authorizeAnyPermission: () => (req, res, next) => next(),
}));

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use(productionRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const { port } = server.address();
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        method,
        port,
        path,
        headers: payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {},
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          server.close(() => resolve({
            statusCode: res.statusCode,
            body: responseBody ? JSON.parse(responseBody) : null,
          }));
        });
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('production routes', () => {
  const orderItemId = '660000000000000000000401';
  const taskId = '660000000000000000100001';
  const fileCheckId = '660000000000000000100002';
  const mediaAssetId = '660000000000000000000902';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET order item task returns production task dto', async () => {
    service.getTaskByOrderItem.mockResolvedValue({
      id: taskId,
      orderItemId,
      status: 'NEED_SCALE',
      rawInternal: 'should-not-exist',
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: `/order-items/${orderItemId}/task`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: expect.objectContaining({ id: taskId, status: 'NEED_SCALE' }),
    });
    expect(service.getTaskByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      permissions: ['PRODUCTION:READ', 'PRODUCTION:WRITE'],
    }));
  });

  test('GET task queue passes filters to service', async () => {
    service.listTasks.mockResolvedValue({
      items: [{
      id: taskId,
      productionStatus: 'NEED_SCALE',
      designAssignmentStatus: 'UNASSIGNED',
      }],
      total: 1,
      page: 2,
      limit: 10,
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/tasks?status=NEED_SCALE&scaleStatus=NEED_SCALE&qcStatus=NOT_READY&blocker=SCALED_OUTPUT_MISSING&designAssignmentStatus=UNASSIGNED&search=J2605&unassigned=true&page=2&limit=10',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items).toEqual([expect.objectContaining({
      id: taskId,
      designAssignmentStatus: 'UNASSIGNED',
    })]);
    expect(service.listTasks).toHaveBeenCalledWith(expect.objectContaining({
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      blocker: 'SCALED_OUTPUT_MISSING',
      designAssignmentStatus: 'UNASSIGNED',
      search: 'J2605',
      unassigned: true,
      page: 2,
      limit: 10,
    }), expect.any(Object));
  });

  test('POST recheck creates or refreshes task', async () => {
    service.createOrRecheckTaskForOrderItem.mockResolvedValue({ id: taskId, status: 'NEED_SCALE' });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/recheck`,
    });

    expect(response.statusCode).toBe(200);
    expect(service.createOrRecheckTaskForOrderItem).toHaveBeenCalledWith(orderItemId, expect.any(Object));
  });

  test('PATCH scaled output validates and calls service', async () => {
    service.uploadScaledFile.mockResolvedValue({ id: taskId, status: 'QC_PENDING' });

    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/file-checks/${fileCheckId}/scaled-output`,
      body: { mediaAssetId },
    });

    expect(response.statusCode).toBe(200);
    expect(service.uploadScaledFile).toHaveBeenCalledWith(taskId, fileCheckId, mediaAssetId, expect.any(Object));
  });

  test('PATCH scaled output rejects invalid media asset id', async () => {
    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/file-checks/${fileCheckId}/scaled-output`,
      body: { mediaAssetId: 'bad-id' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.uploadScaledFile).not.toHaveBeenCalled();
  });

  test('PATCH QC passes decision payload', async () => {
    service.submitQc.mockResolvedValue({ id: taskId, status: 'READY_TO_SEND_VENDOR' });

    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/qc`,
      body: { decision: 'PASSED' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.submitQc).toHaveBeenCalledWith(taskId, { decision: 'PASSED' }, expect.any(Object));
  });

  test('PATCH QC rejects invalid decision', async () => {
    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/qc`,
      body: { decision: 'MAYBE' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.submitQc).not.toHaveBeenCalled();
  });

  test('PATCH assign validates and calls service', async () => {
    service.assignDesignTask.mockResolvedValue({
      id: taskId,
      assignedDesignUserId: '660000000000000000000903',
      designAssignmentStatus: 'ASSIGNED',
    });

    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/assign`,
      body: {
        assignedDesignUserId: '660000000000000000000903',
        designNote: 'Use front mockup first',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(service.assignDesignTask).toHaveBeenCalledWith(taskId, {
      assignedDesignUserId: '660000000000000000000903',
      designNote: 'Use front mockup first',
    }, expect.any(Object));
  });

  test('PATCH bulk assign validates and calls service', async () => {
    service.bulkAssignDesignTasks.mockResolvedValue({
      assigned: [{ id: taskId, assignedDesignUserId: '660000000000000000000903' }],
      failed: [],
    });

    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: '/tasks/bulk-assign',
      body: {
        taskIds: [taskId],
        assignedDesignUserId: '660000000000000000000903',
        designNote: 'Batch 1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(service.bulkAssignDesignTasks).toHaveBeenCalledWith({
      taskIds: [taskId],
      assignedDesignUserId: '660000000000000000000903',
      designNote: 'Batch 1',
    }, expect.any(Object));
  });

  test('PATCH bulk assign rejects invalid task ids', async () => {
    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: '/tasks/bulk-assign',
      body: {
        taskIds: ['bad-id'],
        assignedDesignUserId: '660000000000000000000903',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(service.bulkAssignDesignTasks).not.toHaveBeenCalled();
  });

  test('PATCH claim calls service', async () => {
    service.claimDesignTask.mockResolvedValue({
      id: taskId,
      assignedDesignUserId: '660000000000000000000903',
      designAssignmentStatus: 'ASSIGNED',
    });

    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/claim`,
    });

    expect(response.statusCode).toBe(200);
    expect(service.claimDesignTask).toHaveBeenCalledWith(taskId, expect.any(Object));
  });

  test('PATCH design note validates and calls service', async () => {
    service.updateDesignNote.mockResolvedValue({ id: taskId, designNote: 'Waiting for better image' });

    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/design-note`,
      body: { designNote: 'Waiting for better image' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.updateDesignNote).toHaveBeenCalledWith(taskId, {
      designNote: 'Waiting for better image',
    }, expect.any(Object));
  });

  test('PATCH assign rejects invalid designer id', async () => {
    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/assign`,
      body: { assignedDesignUserId: 'bad-id' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.assignDesignTask).not.toHaveBeenCalled();
  });
});
