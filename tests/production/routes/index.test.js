const http = require('http');
const express = require('express');
const productionRouter = require('../../../src/modules/production/routes');
const errorHandler = require('../../../src/middlewares/errorHandler');
const service = require('../../../src/modules/production/services/productionTask.service');
const orderPublic = require('../../../src/modules/order/public');

jest.mock('../../../src/modules/production/services/productionTask.service');
jest.mock('../../../src/modules/order/public', () => ({
  requestRecheckJob: jest.fn(),
  addressValidationStatuses: { VALID: 'VALID', OVERRIDDEN: 'OVERRIDDEN' },
}));

jest.mock('../../../src/modules/auth/public', () => ({
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

function request(server, {
  method, path, body, headers = {}, rawBody,
}) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const { port } = server.address();
      const payload = rawBody || (body ? JSON.stringify(body) : undefined);
      const requestHeaders = {
        ...headers,
        ...(body && !rawBody ? { 'Content-Type': 'application/json' } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      };
      const req = http.request({
        method,
        port,
        path,
        headers: requestHeaders,
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          let parsedBody = null;
          if (responseBody) {
            try {
              parsedBody = JSON.parse(responseBody);
            } catch (error) {
              parsedBody = responseBody;
            }
          }
          server.close(() => resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsedBody,
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

  test('GET task detail returns production task dto', async () => {
    service.getTaskById.mockResolvedValue({ id: taskId, status: 'QC_PENDING' });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: `/tasks/${taskId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual({ id: taskId, status: 'QC_PENDING' });
    expect(service.getTaskById).toHaveBeenCalledWith(taskId, expect.objectContaining({
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
      path: '/tasks?status=NEED_SCALE&scaleStatus=NEED_SCALE&qcStatus=NOT_READY&salesChannelCode=amazon&blocker=SCALED_OUTPUT_MISSING&designAssignmentStatus=UNASSIGNED&search=J2605&unassigned=true&csUnassigned=true&csStatus=assigned&sellerCode=J2605&tab=address_invalid&page=2&limit=10',
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
      salesChannelCode: 'AMAZON',
      blocker: 'SCALED_OUTPUT_MISSING',
      designAssignmentStatus: 'UNASSIGNED',
      search: 'J2605',
      unassigned: true,
      csUnassigned: true,
      csStatus: 'ASSIGNED',
      sellerCode: 'J2605',
      tab: 'ADDRESS_INVALID',
      page: 2,
      limit: 10,
    }), expect.any(Object));
  });

  test('GET task queue accepts date/user filters and sort', async () => {
    service.listTasks.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/tasks?dateFrom=2026-07-01T00:00:00.000Z&dateTo=2026-07-02T00:00:00.000Z&assignedAtFrom=2026-07-03T00:00:00.000Z&readyAtTo=2026-07-04T00:00:00.000Z&scaleBy=660000000000000000000903&qcBy=660000000000000000000904&sort=-readyAt,assignedAt',
    });

    expect(response.statusCode).toBe(200);
    expect(service.listTasks).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-02T00:00:00.000Z'),
      assignedAtFrom: new Date('2026-07-03T00:00:00.000Z'),
      readyAtTo: new Date('2026-07-04T00:00:00.000Z'),
      scaleBy: '660000000000000000000903',
      qcBy: '660000000000000000000904',
      sort: '-readyAt,assignedAt',
    }), expect.any(Object));
  });

  test('GET task queue rejects unsupported sort field', async () => {
    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/tasks?sort=-notAField',
    });

    expect(response.statusCode).toBe(400);
    expect(service.listTasks).not.toHaveBeenCalled();
  });

  test('GET task summary passes filters to service', async () => {
    service.summarizeTasks.mockResolvedValue({
      total: 4,
      unassigned: 1,
      assigned: 2,
      blocked: 1,
      needScale: 1,
      qcPending: 1,
      readyToSendVendor: 1,
      byScaleStatus: { NEED_SCALE: 2 },
      byQcStatus: { NOT_READY: 2 },
      byAssignmentStatus: { UNASSIGNED: 1, ASSIGNED: 2, OUTPUT_UPLOADED: 1 },
      bySalesChannelCode: { AMAZON: 3, ETSY: 1 },
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/tasks/summary?status=NEED_SCALE&salesChannelCode=etsy&shopId=660000000000000000000201&sellerCode=J2605&tab=failed',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      total: 4,
      unassigned: 1,
      readyToSendVendor: 1,
      bySalesChannelCode: { AMAZON: 3, ETSY: 1 },
    });
    expect(service.summarizeTasks).toHaveBeenCalledWith(expect.objectContaining({
      status: 'NEED_SCALE',
      salesChannelCode: 'ETSY',
      shopId: '660000000000000000000201',
      sellerCode: 'J2605',
      tab: 'FAILED',
    }), expect.any(Object));
  });

  test('GET queue summary passes normalized filters to service', async () => {
    service.summarizeQueueCounts.mockResolvedValue({ blocked: 3, scaleQueue: 5, qcQueue: 2 });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/tasks/queue-summary?salesChannelCode=etsy&search=J2605',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual({ blocked: 3, scaleQueue: 5, qcQueue: 2 });
    expect(service.summarizeQueueCounts).toHaveBeenCalledWith(expect.objectContaining({
      salesChannelCode: 'ETSY',
      search: 'J2605',
    }), expect.any(Object));
  });

  test('GET scale assignees returns assignable employees', async () => {
    service.getScaleAssignees.mockResolvedValue({
      items: [{ id: '660000000000000000000903', fullName: 'Scale User', employeeCode: 'J2605' }],
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/tasks/scale-assignees?search=J26&limit=10',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items).toEqual([expect.objectContaining({
      id: '660000000000000000000903',
      employeeCode: 'J2605',
    })]);
    expect(service.getScaleAssignees).toHaveBeenCalledWith({
      search: 'J26',
      limit: 10,
    }, expect.any(Object));
  });

  test('GET CS assignees returns assignable employees', async () => {
    service.getCsAssignees.mockResolvedValue({
      items: [{ id: '660000000000000000000905', fullName: 'CS User', employeeCode: 'CS02' }],
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/tasks/cs-assignees?search=CS&limit=10',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items).toEqual([expect.objectContaining({
      id: '660000000000000000000905',
      employeeCode: 'CS02',
    })]);
    expect(service.getCsAssignees).toHaveBeenCalledWith({
      search: 'CS',
      limit: 10,
    }, expect.any(Object));
  });

  test('POST recheck queues a production job', async () => {
    orderPublic.requestRecheckJob.mockResolvedValue({ id: 'job-1', status: 'QUEUED' });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/order-items/${orderItemId}/recheck`,
    });

    expect(response.statusCode).toBe(202);
    expect(orderPublic.requestRecheckJob).toHaveBeenCalledWith(orderItemId, 'PRODUCTION', expect.any(Object));
  });

  test('POST recheck PSD blocked validates payload and calls service', async () => {
    service.recheckPsdBlockedTasks.mockResolvedValue({
      checked: 1,
      cleared: 1,
      stillBlocked: 0,
      items: [{ taskId, status: 'CLEARED', blockers: [] }],
    });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/tasks/recheck-psd-blocked',
      body: { shopId: '660000000000000000000201', limit: 25 },
    });

    expect(response.statusCode).toBe(200);
    expect(service.recheckPsdBlockedTasks).toHaveBeenCalledWith({
      shopId: '660000000000000000000201',
      limit: 25,
    }, expect.any(Object));
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

  test('POST scaled output file accepts multipart file and calls service', async () => {
    const fs = require('fs');
    let uploadedFile;
    service.uploadScaledOutputFile.mockImplementation(async (_taskId, _fileCheckId, file) => {
      uploadedFile = file;
      await fs.promises.rm(file.path, { force: true });
      return { id: taskId, status: 'QC_PENDING' };
    });
    const boundary = '----productionuploadtest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="scaled.png"',
      'Content-Type: image/png',
      '',
      'png-data',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/tasks/${taskId}/file-checks/${fileCheckId}/scaled-output-file`,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(service.uploadScaledOutputFile).toHaveBeenCalledWith(taskId, fileCheckId, expect.objectContaining({
      originalname: 'scaled.png',
      mimetype: 'image/png',
      size: 8,
    }), expect.any(Object));
    expect(uploadedFile.path).toBeTruthy();
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

  test('POST manual file check validates and calls service', async () => {
    service.addManualFileCheck.mockResolvedValue({ id: taskId, status: 'NEED_SCALE' });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/tasks/${taskId}/file-checks/manual`,
      body: {
        slotKey: 'front',
        slotLabel: 'Front',
        sourceType: 'customer_image',
        inputAssetId: mediaAssetId,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(service.addManualFileCheck).toHaveBeenCalledWith(taskId, {
      slotKey: 'FRONT',
      slotLabel: 'Front',
      sourceType: 'CUSTOMER_IMAGE',
      inputAssetId: mediaAssetId,
    }, expect.any(Object));
  });

  test('POST manual file check rejects invalid slot key', async () => {
    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/tasks/${taskId}/file-checks/manual`,
      body: { slotKey: 'front*bad' },
    });

    expect(response.statusCode).toBe(400);
    expect(service.addManualFileCheck).not.toHaveBeenCalled();
  });

  test('POST manual scaled output file passes slot fields and upload to service', async () => {
    const fs = require('fs');
    let uploadedManualFile;
    service.addManualScaledOutputFile.mockImplementation(async (_taskId, payload, file) => {
      uploadedManualFile = file;
      await fs.promises.rm(file.path, { force: true });
      return { id: taskId, status: 'QC_PENDING', slotKey: payload.slotKey };
    });
    const boundary = '----productionmanualuploadtest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="slotKey"',
      '',
      'front',
      `--${boundary}`,
      'Content-Disposition: form-data; name="slotLabel"',
      '',
      'Front',
      `--${boundary}`,
      'Content-Disposition: form-data; name="sourceType"',
      '',
      'customer_image',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="front.png"',
      'Content-Type: image/png',
      '',
      'png-data',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/tasks/${taskId}/file-checks/manual/scaled-output-file`,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(service.addManualScaledOutputFile).toHaveBeenCalledWith(taskId, {
      slotKey: 'FRONT',
      slotLabel: 'Front',
      sourceType: 'CUSTOMER_IMAGE',
    }, expect.objectContaining({
      originalname: 'front.png',
      mimetype: 'image/png',
      size: 8,
    }), expect.any(Object));
    expect(uploadedManualFile.path).toBeTruthy();
  });

  test('POST manual scaled output file accepts slot fields from query fallback', async () => {
    const fs = require('fs');
    service.addManualScaledOutputFile.mockImplementation(async (_taskId, _payload, file) => {
      await fs.promises.rm(file.path, { force: true });
      return { id: taskId, status: 'QC_PENDING' };
    });
    const boundary = '----productionmanualqueryuploadtest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="front.png"',
      'Content-Type: image/png',
      '',
      'png-data',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/tasks/${taskId}/file-checks/manual/scaled-output-file?slotKey=front&slotLabel=Front`,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(service.addManualScaledOutputFile).toHaveBeenCalledWith(taskId, {
      slotKey: 'FRONT',
      slotLabel: 'Front',
      sourceType: 'CUSTOMER_IMAGE',
    }, expect.objectContaining({ originalname: 'front.png' }), expect.any(Object));
  });

  test('POST manual scaled output file returns compact response when requested', async () => {
    const fs = require('fs');
    service.addManualScaledOutputFile.mockImplementation(async (_taskId, _payload, file) => {
      await fs.promises.rm(file.path, { force: true });
      return {
        id: taskId,
        status: 'QC_PENDING',
        scaleStatus: 'SCALED',
        qcStatus: 'PENDING',
        order: { id: orderItemId },
        customization: { customerInputs: { texts: [{ label: 'Name', value: 'Ava' }] } },
        fileChecks: [{
          id: fileCheckId,
          slotKey: 'FRONT',
          slotLabel: 'Front',
          outputAssetId: mediaAssetId,
          outputAssetDownloadUrl: `/api/media/assets/${mediaAssetId}/download`,
          outputStatus: 'UPLOADED',
          scaleStatus: 'SCALED',
          qcStatus: 'PENDING',
        }],
      };
    });
    const boundary = '----productionmanualcompactuploadtest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="front.png"',
      'Content-Type: image/png',
      '',
      'png-data',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/tasks/${taskId}/file-checks/manual/scaled-output-file?slotKey=FRONT&compact=true`,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual({
      taskId,
      taskStatus: 'QC_PENDING',
      scaleStatus: 'SCALED',
      qcStatus: 'PENDING',
      fileCheckId,
      slotKey: 'FRONT',
      slotLabel: 'Front',
      outputAssetId: mediaAssetId,
      outputAssetDownloadUrl: `/api/media/assets/${mediaAssetId}/download`,
      outputStatus: 'UPLOADED',
      fileCheckScaleStatus: 'SCALED',
      fileCheckQcStatus: 'PENDING',
    });
  });

  test('POST manual scaled output file reports slotKey validation instead of root object error', async () => {
    const boundary = '----productionmanualmissingslottest';
    const rawBody = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="front.png"',
      'Content-Type: image/png',
      '',
      'png-data',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const response = await request(createTestServer(), {
      method: 'POST',
      path: `/tasks/${taskId}/file-checks/manual/scaled-output-file`,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody,
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.error.details[0].path).toEqual(['slotKey']);
    expect(response.body.error.details[0].type).toBe('any.required');
    expect(service.addManualScaledOutputFile).not.toHaveBeenCalled();
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

  test('POST bulk push vendor validates and calls service', async () => {
    service.bulkPushVendor.mockResolvedValue({
      sent: [{ id: taskId, status: 'SENT_TO_VENDOR' }],
      failed: [],
    });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/tasks/bulk-push-vendor',
      body: {
        taskIds: [taskId],
        vendorSubmissionIdsByTaskId: { [taskId]: '660000000000000000129001' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(service.bulkPushVendor).toHaveBeenCalledWith({
      taskIds: [taskId],
      vendorSubmissionIdsByTaskId: { [taskId]: '660000000000000000129001' },
    }, expect.any(Object));
  });

  test('GET QC export returns Excel response', async () => {
    service.exportQcTasksExcel.mockResolvedValue({
      filename: 'production-qc-tasks-2026-07-15.xls',
      contentType: 'application/vnd.ms-excel; charset=utf-8',
      content: '<Workbook><Row><Cell>Task ID</Cell></Row></Workbook>',
    });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/tasks/qc/export?qcStatus=pending&sellerCode=J2605',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.ms-excel');
    expect(response.body).toContain('Workbook');
    expect(response.body).toContain('Task ID');
    expect(service.exportQcTasksExcel).toHaveBeenCalledWith(expect.objectContaining({
      qcStatus: 'PENDING',
      sellerCode: 'J2605',
    }), expect.any(Object));
  });

  test('PATCH assign CS validates and calls service', async () => {
    service.assignCsTask.mockResolvedValue({
      id: taskId,
      csAssigneeId: '660000000000000000000905',
      csStatus: 'ASSIGNED',
    });

    const response = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/assign-cs`,
      body: {
        csAssigneeId: '660000000000000000000905',
        csNote: 'Check customer crop',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(service.assignCsTask).toHaveBeenCalledWith(taskId, {
      csAssigneeId: '660000000000000000000905',
      csNote: 'Check customer crop',
    }, expect.any(Object));
  });

  test('PATCH CS note and status validate and call service', async () => {
    service.updateCsNote.mockResolvedValue({ id: taskId, csNote: 'Need CS review' });
    service.updateCsStatus.mockResolvedValue({ id: taskId, csStatus: 'DONE' });

    const noteResponse = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/cs-note`,
      body: { csNote: 'Need CS review' },
    });
    expect(noteResponse.statusCode).toBe(200);
    expect(service.updateCsNote).toHaveBeenCalledWith(taskId, {
      csNote: 'Need CS review',
    }, expect.any(Object));

    const statusResponse = await request(createTestServer(), {
      method: 'PATCH',
      path: `/tasks/${taskId}/cs-status`,
      body: { csStatus: 'done' },
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(service.updateCsStatus).toHaveBeenCalledWith(taskId, {
      csStatus: 'DONE',
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
