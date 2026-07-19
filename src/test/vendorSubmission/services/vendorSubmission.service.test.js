jest.mock('../../../modules/production/public', () => ({
  getTaskById: jest.fn(),
  listTasks: jest.fn(),
  markSentToVendor: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/vendorSubmission/repositories/vendorSubmission.repository', () => ({
  create: jest.fn(),
  findActiveByProductionTask: jest.fn(),
  findById: jest.fn(),
  findByOrderItemId: jest.fn(),
  findByProductionTaskId: jest.fn(),
  listLatestByProductionTaskIds: jest.fn(),
  list: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../../../modules/vendorSubmission/services/submitAdapters/registry', () => ({
  getAdapter: jest.fn(),
}));

const productionPublic = require('../../../modules/production/public');
const authPublic = require('../../../modules/auth/public');
const repository = require('../../../modules/vendorSubmission/repositories/vendorSubmission.repository');
const submitRegistry = require('../../../modules/vendorSubmission/services/submitAdapters/registry');
const service = require('../../../modules/vendorSubmission/services/vendorSubmission.service');

describe('vendorSubmission.service', () => {
  const submissionId = '660000000000000000120001';
  const productionTaskId = '660000000000000000120002';
  const orderId = '660000000000000000120003';
  const orderItemId = '660000000000000000120004';
  const shopId = '660000000000000000120005';
  const fulfillmentPlanId = '660000000000000000120006';
  const vendorProductId = '660000000000000000120007';
  const vendorCostCenterId = '660000000000000000120008';
  const actorId = '660000000000000000120009';

  const readyTask = {
    id: productionTaskId,
    orderId,
    orderItemId,
    shopId,
    fulfillmentPlanId,
    vendorProduct: { id: vendorProductId, code: 'PRODUCT_1', name: 'Product 1' },
    vendorCostCenter: { id: vendorCostCenterId, code: 'CC_1', standardSize: 'M' },
    orderItem: { sku: 'J2508-TS1S-05032026-335', title: 'Senior Mom Shirt' },
    listing: { id: '660000000000000000120010', sku: 'LISTING-1' },
    internalTemplate: { id: '660000000000000000120011', code: 'TS1S' },
    fileChecks: [{
      id: '660000000000000000120012',
      slotKey: 'FRONT',
      outputAssetId: '660000000000000000120013',
      localPath: 'C:\\tmp\\secret.png',
      providerSecret: 'secret',
    }],
    status: 'READY_TO_SEND_VENDOR',
  };

  const submission = {
    _id: submissionId,
    productionTaskId,
    orderId,
    orderItemId,
    shopId,
    fulfillmentPlanId,
    vendorProductId,
    vendorCostCenterId,
    status: 'READY',
    payloadSnapshot: { orderItem: readyTask.orderItem, fileChecks: readyTask.fileChecks },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    productionPublic.getTaskById.mockResolvedValue(readyTask);
    productionPublic.listTasks.mockResolvedValue({
      items: [{ id: productionTaskId }],
      total: 1,
      page: 1,
      limit: 50,
    });
    productionPublic.markSentToVendor.mockResolvedValue({ id: productionTaskId, status: 'SENT_TO_VENDOR' });
    authPublic.canAccessScope.mockReturnValue(true);
    repository.findActiveByProductionTask.mockResolvedValue(null);
    repository.create.mockResolvedValue(submission);
    repository.findById.mockResolvedValue(submission);
    repository.listLatestByProductionTaskIds.mockResolvedValue([]);
    repository.updateById.mockImplementation(async (_id, patch) => ({ ...submission, ...patch }));
    submitRegistry.getAdapter.mockReturnValue({
      provider: 'MERCHIZE',
      buildPayload: jest.fn(() => ({
        order_id: '113-TEST-ORDER',
        shipping_info: { full_name: 'Jane Buyer', address_1: '123 Main', city: 'Boise', state: 'ID', postcode: '83701', country: 'US' },
        items: [{ merchize_sku: 'MZ-SKU', image: 'https://cdn.example/mockup.jpg', design_front: 'https://cdn.example/front.png', attributes: [{ name: 'Size', option: 'M' }] }],
      })),
      validatePayload: jest.fn(),
      submitPayload: jest.fn(async () => ({
        provider: 'MERCHIZE',
        externalId: 'MZ-ORDER-1',
        response: { success: true, data: { _id: 'MZ-ORDER-1' } },
      })),
    });
  });

  test('creates a ready submission from a ready production task and stores safe snapshot', async () => {
    const result = await service.createFromProductionTask(productionTaskId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(productionPublic.getTaskById).toHaveBeenCalledWith(productionTaskId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      productionTaskId,
      orderId,
      orderItemId,
      shopId,
      fulfillmentPlanId,
      vendorProductId,
      vendorCostCenterId,
      status: 'READY',
      statusHistory: [expect.objectContaining({
        status: 'READY',
        actorId,
        reason: 'Created from production task',
        at: expect.any(Date),
      })],
      payloadSnapshot: expect.objectContaining({
        orderItem: readyTask.orderItem,
        vendorProduct: readyTask.vendorProduct,
        vendorCostCenter: readyTask.vendorCostCenter,
      }),
    }));
    expect(JSON.stringify(repository.create.mock.calls[0][0].payloadSnapshot)).not.toContain('localPath');
    expect(JSON.stringify(repository.create.mock.calls[0][0].payloadSnapshot)).not.toContain('providerSecret');
    expect(result).toMatchObject({ id: submissionId, status: 'READY' });
  });

  test('create returns existing active submission for the same production task', async () => {
    repository.findActiveByProductionTask.mockResolvedValueOnce(submission);

    const result = await service.createFromProductionTask(productionTaskId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    });

    expect(repository.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: submissionId, productionTaskId });
  });

  test('create from non-ready production task returns conflict', async () => {
    productionPublic.getTaskById.mockResolvedValueOnce({ ...readyTask, status: 'QC_PENDING' });

    await expect(service.createFromProductionTask(productionTaskId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
  });

  test('scoped user cannot create submission for inaccessible shop', async () => {
    authPublic.canAccessScope.mockReturnValueOnce(false);

    await expect(service.createFromProductionTask(productionTaskId, {
      permissions: [],
      scopes: [],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });

  test('payload preview excludes localPath and provider secrets', async () => {
    const result = await service.getPayloadPreview(submissionId, { permissions: ['VENDOR_SUBMISSIONS:READ'] });

    expect(result).toMatchObject({ orderItem: readyTask.orderItem });
    expect(JSON.stringify(result)).not.toContain('localPath');
    expect(JSON.stringify(result)).not.toContain('providerSecret');
  });

  test('listSubmissions applies scoped shop ids before querying repository', async () => {
    repository.list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });

    await service.listSubmissions({ page: 1, limit: 20 }, {
      permissions: [],
      scopes: [{
        scopeType: 'shop',
        scopeId: shopId,
        permissions: ['VENDOR_SUBMISSIONS:READ'],
      }],
    });

    expect(repository.list).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      shopIds: [shopId],
    });
  });

  test('mark submitted updates submission and calls production handoff', async () => {
    const result = await service.markSubmitted(submissionId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      status: 'SUBMITTED',
      submittedBy: actorId,
      submittedAt: expect.any(Date),
      statusHistory: [expect.objectContaining({
        status: 'SUBMITTED',
        actorId,
        reason: null,
        at: expect.any(Date),
      })],
    }));
    expect(productionPublic.markSentToVendor).toHaveBeenCalledWith(productionTaskId, submissionId, expect.objectContaining({
      accountId: actorId,
    }));
    expect(result.status).toBe('SUBMITTED');
  });

  test('mark submitted is idempotent when production task is already sent for same submission', async () => {
    repository.findById.mockResolvedValueOnce({ ...submission, status: 'READY' });
    productionPublic.markSentToVendor.mockRejectedValueOnce(Object.assign(new Error('Production task is not ready to send vendor'), {
      statusCode: 409,
      details: { status: 'SENT_TO_VENDOR', vendorSubmissionId: submissionId },
    }));

    const result = await service.markSubmitted(submissionId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      status: 'SUBMITTED',
    }));
    expect(result.status).toBe('SUBMITTED');
  });

  test('mark submitted is idempotent for already submitted submission', async () => {
    repository.findById.mockResolvedValueOnce({ ...submission, status: 'SUBMITTED' });

    const result = await service.markSubmitted(submissionId, { permissions: ['VENDOR_SUBMISSIONS:WRITE'] });

    expect(repository.updateById).not.toHaveBeenCalled();
    expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
    expect(result.status).toBe('SUBMITTED');
  });

  test('mark failed requires non-empty failure reason', async () => {
    await expect(service.markFailed(submissionId, { failureReason: '  ' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  test('recheck production task creates or returns ready submission', async () => {
    const result = await service.recheckProductionTask(productionTaskId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    });

    expect(productionPublic.getTaskById).toHaveBeenCalledWith(productionTaskId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    });
    expect(repository.create).toHaveBeenCalled();
    expect(result).toMatchObject({ id: submissionId, status: 'READY' });
  });

  test('batch recheck ready production tasks returns per-task results', async () => {
    const secondTaskId = '660000000000000000120099';
    productionPublic.listTasks.mockResolvedValueOnce({
      items: [{ id: productionTaskId }, { id: secondTaskId }],
      total: 2,
      page: 1,
      limit: 50,
    });
    productionPublic.getTaskById
      .mockResolvedValueOnce(readyTask)
      .mockResolvedValueOnce({ ...readyTask, id: secondTaskId, status: 'QC_PENDING' });

    const result = await service.recheckReadyProductionTasks({ shopId, limit: 50 }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    });

    expect(productionPublic.listTasks).toHaveBeenCalledWith({
      status: 'READY_TO_SEND_VENDOR',
      shopId,
      page: 1,
      limit: 50,
    }, expect.objectContaining({
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      system: true,
      source: 'VENDOR_SUBMISSION_RECHECK',
    }));
    expect(result).toMatchObject({
      checked: 2,
      createdOrExisting: 1,
      skipped: 1,
    });
    expect(result.items[0]).toMatchObject({
      productionTaskId,
      submissionId,
      status: 'READY',
    });
    expect(result.items[1]).toMatchObject({
      productionTaskId: secondTaskId,
      errorCode: 'CONFLICT_ERROR',
    });
  });

  test('mark failed appends failure reason to status history', async () => {
    const result = await service.markFailed(submissionId, { failureReason: 'Vendor portal rejected payload' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      status: 'FAILED',
      failedBy: actorId,
      failureReason: 'Vendor portal rejected payload',
      statusHistory: [expect.objectContaining({
        status: 'FAILED',
        actorId,
        reason: 'Vendor portal rejected payload',
        at: expect.any(Date),
      })],
    }));
    expect(result.statusHistory).toEqual([expect.objectContaining({
      status: 'FAILED',
      actorId,
      reason: 'Vendor portal rejected payload',
    })]);
  });

  test('retry failed submission moves it back to ready and keeps failure evidence', async () => {
    repository.findById.mockResolvedValueOnce({
      ...submission,
      status: 'FAILED',
      failedAt: new Date('2026-07-06T00:00:00.000Z'),
      failureReason: 'Vendor rejected payload',
      statusHistory: [{ status: 'FAILED', reason: 'Vendor rejected payload' }],
    });

    const result = await service.retry(submissionId, { reason: 'Retry after payload fix' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      status: 'READY',
      failureReason: 'Vendor rejected payload',
      statusHistory: expect.arrayContaining([
        expect.objectContaining({ status: 'READY', actorId, reason: 'Retry after payload fix' }),
      ]),
    }));
    expect(result.status).toBe('READY');
    expect(result.failureReason).toBe('Vendor rejected payload');
  });

  test('retry rejects non-failed submission', async () => {
    repository.findById.mockResolvedValueOnce({ ...submission, status: 'READY' });

    await expect(service.retry(submissionId, {}, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('lists latest submissions by production task ids', async () => {
    repository.listLatestByProductionTaskIds.mockResolvedValueOnce([{
      ...submission,
      status: 'FAILED',
      failureReason: 'Vendor rejected payload',
    }]);

    const result = await service.listLatestByProductionTaskIds([productionTaskId], {
      permissions: ['VENDOR_SUBMISSIONS:READ'],
    });

    expect(repository.listLatestByProductionTaskIds).toHaveBeenCalledWith([productionTaskId]);
    expect(result).toEqual([expect.objectContaining({
      id: submissionId,
      productionTaskId,
      status: 'FAILED',
      failureReason: 'Vendor rejected payload',
    })]);
  });

  test('cancel does not call production status update', async () => {
    const result = await service.cancel(submissionId, { cancelReason: 'Duplicate' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      status: 'CANCELLED',
      cancelledBy: actorId,
      cancelReason: 'Duplicate',
      statusHistory: [expect.objectContaining({
        status: 'CANCELLED',
        actorId,
        reason: 'Duplicate',
        at: expect.any(Date),
      })],
    }));
    expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
    expect(result.status).toBe('CANCELLED');
  });

  test('cancel submitted submission returns conflict', async () => {
    repository.findById.mockResolvedValueOnce({ ...submission, status: 'SUBMITTED' });

    await expect(service.cancel(submissionId, { cancelReason: 'Too late' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('submit to vendor defaults to dry run and does not mutate submission', async () => {
    const result = await service.submitToVendor(submissionId, { provider: 'MERCHIZE' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    });

    const adapter = submitRegistry.getAdapter.mock.results[0].value;
    expect(submitRegistry.getAdapter).toHaveBeenCalledWith('MERCHIZE');
    expect(adapter.submitPayload).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: 'MERCHIZE',
      dryRun: true,
      payload: { order_id: '113-TEST-ORDER' },
      validation: { ok: true },
    });
  });

  test('submit to vendor posts payload, marks submission submitted, and calls production handoff', async () => {
    const result = await service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    const adapter = submitRegistry.getAdapter.mock.results[0].value;
    expect(adapter.submitPayload).toHaveBeenCalledWith(expect.objectContaining({ order_id: '113-TEST-ORDER' }));
    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      status: 'SUBMITTED',
      provider: 'MERCHIZE',
      vendorExternalOrderId: 'MZ-ORDER-1',
      submittedBy: actorId,
      submittedAt: expect.any(Date),
      submittedResponse: { success: true, data: { _id: 'MZ-ORDER-1' } },
    }));
    expect(productionPublic.markSentToVendor).toHaveBeenCalledWith(productionTaskId, submissionId, expect.objectContaining({
      accountId: actorId,
    }));
    expect(result).toMatchObject({
      status: 'SUBMITTED',
      provider: 'MERCHIZE',
      vendorExternalOrderId: 'MZ-ORDER-1',
    });
  });

  test('submit to vendor stores failed status when vendor rejects after POST', async () => {
    submitRegistry.getAdapter.mockReturnValueOnce({
      provider: 'MERCHIZE',
      buildPayload: jest.fn(() => ({ order_id: '113-TEST-ORDER' })),
      validatePayload: jest.fn(),
      submitPayload: jest.fn().mockRejectedValueOnce(Object.assign(new Error('Merchize rejected order'), {
        statusCode: 409,
        code: 'CONFLICT_ERROR',
        details: { response: { success: false, message: 'Invalid Merchize SKU' } },
      })),
    });

    await expect(service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      status: 'FAILED',
      provider: 'MERCHIZE',
      failedBy: actorId,
      failedAt: expect.any(Date),
      failureReason: 'Merchize rejected order',
      submittedResponse: { success: false, message: 'Invalid Merchize SKU' },
    }));
    expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
  });

  test('keeps a ready submission retryable when the provider transport fails', async () => {
    submitRegistry.getAdapter.mockReturnValueOnce({
      provider: 'MERCHIZE',
      buildPayload: jest.fn(() => ({ order_id: '113-TEST-ORDER' })),
      validatePayload: jest.fn(),
      submitPayload: jest.fn().mockRejectedValueOnce(Object.assign(new Error('socket hang up'), {
        code: 'ECONNRESET',
      })),
    });

    await expect(service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    })).rejects.toMatchObject({
      message: 'socket hang up',
      code: 'ECONNRESET',
    });

    expect(repository.updateById).not.toHaveBeenCalled();
    expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
  });

  test('does not post a submission that is already submitted', async () => {
    repository.findById.mockResolvedValueOnce({ ...submission, status: 'SUBMITTED' });

    await expect(service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    const adapter = submitRegistry.getAdapter.mock.results[0].value;
    expect(adapter.submitPayload).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('accepts an already-completed production handoff for the same submission', async () => {
    productionPublic.markSentToVendor.mockRejectedValueOnce(Object.assign(new Error('already sent'), {
      statusCode: 409,
      details: { status: 'SENT_TO_VENDOR', vendorSubmissionId: submissionId },
    }));

    await expect(service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    })).resolves.toMatchObject({ status: 'SUBMITTED' });
  });

  test('removes unsafe fields from the provider response before persisting it', async () => {
    submitRegistry.getAdapter.mockReturnValueOnce({
      provider: 'MERCHIZE',
      buildPayload: jest.fn(() => ({ order_id: '113-TEST-ORDER' })),
      validatePayload: jest.fn(),
      submitPayload: jest.fn().mockResolvedValueOnce({
        provider: 'MERCHIZE',
        externalId: 'MZ-ORDER-1',
        response: { success: true, token: 'do-not-store', localPath: 'C:\\private\\order.json' },
      }),
    });

    await service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    const patch = repository.updateById.mock.calls[0][1];
    expect(patch.submittedResponse).toEqual({ success: true });
  });
});
