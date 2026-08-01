jest.mock('../../../modules/production/public', () => ({
  getTaskById: jest.fn(),
  listTasks: jest.fn(),
  markSentToVendor: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/order/public', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/vendor/public', () => ({
  getVendorIntegrationCredential: jest.fn(),
}));

jest.mock('../../../modules/notification/public', () => ({
  notify: jest.fn(),
}));

jest.mock('../../../modules/audit/public', () => ({
  record: jest.fn(),
}));

jest.mock('../../../shared/utils/logger', () => ({
  warn: jest.fn(),
}));

jest.mock('../../../modules/vendorSubmission/repositories/vendorSubmission.repository', () => ({
  create: jest.fn(),
  findActiveByProductionTask: jest.fn(),
  findById: jest.fn(),
  findByOrderItemId: jest.fn(),
  findByProductionTaskId: jest.fn(),
  listLatestByProductionTaskIds: jest.fn(),
  list: jest.fn(),
  claimReadyForSubmit: jest.fn(),
  transitionStatus: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../../../modules/vendorSubmission/services/submitAdapters/registry', () => ({
  getAdapter: jest.fn(),
}));

const productionPublic = require('../../../modules/production/public');
const authPublic = require('../../../modules/auth/public');
const orderPublic = require('../../../modules/order/public');
const vendorPublic = require('../../../modules/vendor/public');
const notificationPublic = require('../../../modules/notification/public');
const auditPublic = require('../../../modules/audit/public');
const logger = require('../../../shared/utils/logger');
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
  const assignedStaffId = '660000000000000000120014';
  const vendorId = '660000000000000000120015';

  const readyTask = {
    id: productionTaskId,
    orderId,
    orderItemId,
    shopId,
    fulfillmentPlanId,
    vendorProduct: {
      id: vendorProductId,
      code: 'PRODUCT_1',
      name: 'Product 1',
      vendor: { id: vendorId, providerKey: 'MERCHIZE', name: 'Merchize' },
    },
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
    payloadSnapshot: {
      orderItem: readyTask.orderItem,
      fileChecks: readyTask.fileChecks,
      vendorProduct: readyTask.vendorProduct,
    },
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
    repository.claimReadyForSubmit.mockImplementation(async (_id, patch) => ({
      ...submission, status: 'SUBMITTING', provider: patch.provider,
      submitOperationKey: patch.operationKey, submitClaimedAt: patch.claimedAt,
    }));
    repository.transitionStatus.mockImplementation(async (_id, _from, patch) => ({ ...submission, ...patch }));
    repository.listLatestByProductionTaskIds.mockResolvedValue([]);
    repository.updateById.mockImplementation(async (_id, patch) => ({ ...submission, ...patch }));
    orderPublic.findById.mockResolvedValue({ _id: orderId, assignedStaffId });
    vendorPublic.getVendorIntegrationCredential.mockResolvedValue({
      vendorId, providerKey: 'MERCHIZE', baseUrl: 'https://vendor.example', accessToken: 'token',
    });
    notificationPublic.notify.mockResolvedValue({ delivered: true, id: 'notification-1' });
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

  test('records a submission creation with the account actor and shop scope', async () => {
    await service.createFromProductionTask(productionTaskId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: actorId,
      action: 'VENDOR_SUBMISSION_CREATED',
      entityType: 'VENDOR_SUBMISSION',
      entityId: submissionId,
      scopeType: 'SHOP',
      scopeId: shopId,
      source: 'HTTP',
    }), {});
    expect(JSON.stringify(auditPublic.record.mock.calls[0][0])).not.toContain('localPath');
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
      auditActorType: 'ACCOUNT',
      auditSource: 'HTTP',
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
    expect(productionPublic.markSentToVendor).toHaveBeenCalledWith(
      productionTaskId,
      submissionId,
      expect.any(Object),
    );
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
    const updatedAt = new Date('2026-07-28T06:00:00.000Z');
    repository.updateById.mockImplementationOnce(async (_id, patch) => ({
      ...submission,
      ...patch,
      updatedAt,
    }));

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
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VENDOR_SUBMISSION_FAILED',
      changes: expect.objectContaining({ reasonProvided: true }),
    }), {});
    expect(notificationPublic.notify).toHaveBeenCalledWith({
      recipientAccountId: assignedStaffId,
      type: 'VENDOR_SUBMISSION_FAILED',
      title: 'Vendor submission failed',
      message: 'A vendor submission for your order failed and needs attention.',
      relatedResource: { type: 'vendorSubmission', id: submissionId },
      deduplicationKey: `VENDOR_SUBMISSION_FAILED:${submissionId}:${assignedStaffId}:${updatedAt.toISOString()}`,
    });
  });

  test('keeps a failure reason in the domain but excludes credential and PII sentinels from audit', async () => {
    const reason = 'credential=sk_failure_SENTINEL customer=private.person@example.test tracking=TRACK-FAIL-9988';

    await service.markFailed(submissionId, { failureReason: reason }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      failureReason: reason,
      statusHistory: [expect.objectContaining({ reason })],
    }));
    const auditPayload = JSON.stringify(auditPublic.record.mock.calls[0][0]);
    expect(auditPayload).not.toContain('sk_failure_SENTINEL');
    expect(auditPayload).not.toContain('private.person@example.test');
    expect(auditPayload).not.toContain('TRACK-FAIL-9988');
  });

  test('distinguishes same-millisecond submission writes and reuses the key for exact persisted replay', async () => {
    const updatedAt = new Date('2026-07-29T03:00:00.000Z');
    repository.updateById
      .mockResolvedValueOnce({ ...submission, status: 'FAILED', updatedAt, __v: 4 })
      .mockResolvedValueOnce({ ...submission, status: 'FAILED', updatedAt, __v: 5 })
      .mockResolvedValueOnce({ ...submission, status: 'FAILED', updatedAt, __v: 5 });

    await service.markFailed(submissionId, { failureReason: 'Vendor rejected payload' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], worker: true,
    });
    await service.markFailed(submissionId, { failureReason: 'Vendor rejected payload' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], worker: true,
    });
    await service.markFailed(submissionId, { failureReason: 'Vendor rejected payload' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], worker: true,
    });

    const keys = auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey);
    expect(keys).toHaveLength(3);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
  });

  test('skips vendor failure notification when the order has no assignee', async () => {
    orderPublic.findById.mockResolvedValueOnce({ _id: orderId, assignedStaffId: null });

    await expect(service.markFailed(submissionId, { failureReason: 'Vendor rejected payload' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    })).resolves.toMatchObject({ status: 'FAILED' });

    expect(notificationPublic.notify).not.toHaveBeenCalled();
  });

  test('keeps vendor failure persisted when owner lookup fails', async () => {
    orderPublic.findById.mockRejectedValueOnce(Object.assign(new Error('order unavailable'), { code: 'ORDER_UNAVAILABLE' }));

    await expect(service.markFailed(submissionId, { failureReason: 'Vendor rejected payload' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    })).resolves.toMatchObject({ status: 'FAILED' });

    expect(logger.warn).toHaveBeenCalledWith('vendor_submission_notification_failed', {
      submissionId,
      errorCode: 'ORDER_UNAVAILABLE',
    });
  });

  test('keeps vendor failure persisted when notification delivery fails', async () => {
    notificationPublic.notify.mockResolvedValueOnce({ delivered: false, errorCode: 'INTERNAL_SERVER_ERROR' });

    await expect(service.markFailed(submissionId, { failureReason: 'Vendor rejected payload' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    })).resolves.toMatchObject({ status: 'FAILED' });
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
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VENDOR_SUBMISSION_RETRIED',
      changes: expect.objectContaining({ reasonProvided: true }),
    }), {});
  });

  test('keeps a retry reason in history but excludes its credential, PII, and tracking sentinels from audit', async () => {
    const reason = 'token=retry_secret_SENTINEL buyer=retry.person@example.test tracking=TRACK-RETRY-8877';
    repository.findById.mockResolvedValueOnce({
      ...submission,
      status: 'FAILED',
      failureReason: 'Vendor rejected payload',
    });

    await service.retry(submissionId, { reason }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      statusHistory: [expect.objectContaining({ reason })],
    }));
    const auditPayload = JSON.stringify(auditPublic.record.mock.calls[0][0]);
    expect(auditPayload).not.toContain('retry_secret_SENTINEL');
    expect(auditPayload).not.toContain('retry.person@example.test');
    expect(auditPayload).not.toContain('TRACK-RETRY-8877');
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
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VENDOR_SUBMISSION_CANCELLED',
      changes: expect.objectContaining({ reasonProvided: true }),
    }), {});
  });

  test('preserves a valid long cancel reason in domain history while bounding only its audit copy', async () => {
    const reason = 'x'.repeat(1000);

    await service.cancel(submissionId, { cancelReason: reason }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      cancelReason: reason,
      statusHistory: [expect.objectContaining({ reason })],
    }));
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VENDOR_SUBMISSION_CANCELLED',
      changes: expect.objectContaining({ reasonProvided: true }),
    }), {});
  });

  test('keeps a cancel reason in the domain but excludes credential, PII, and tracking sentinels from audit', async () => {
    const reason = 'password=cancel_secret_SENTINEL customer=cancel.person@example.test tracking=TRACK-CANCEL-7766';

    await service.cancel(submissionId, { cancelReason: reason }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      cancelReason: reason,
      statusHistory: [expect.objectContaining({ reason })],
    }));
    const auditPayload = JSON.stringify(auditPublic.record.mock.calls[0][0]);
    expect(auditPayload).not.toContain('cancel_secret_SENTINEL');
    expect(auditPayload).not.toContain('cancel.person@example.test');
    expect(auditPayload).not.toContain('TRACK-CANCEL-7766');
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

  test('rejects a provider that does not match the mapped vendor snapshot', async () => {
    await expect(service.submitToVendor(submissionId, { provider: 'PRINTWAY', dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], accountId: actorId,
    })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(repository.claimReadyForSubmit).not.toHaveBeenCalled();
  });

  test('allows only one atomic claim to invoke the provider', async () => {
    repository.claimReadyForSubmit.mockResolvedValueOnce(null);

    await expect(service.submitToVendor(submissionId, { dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], accountId: actorId,
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(submitRegistry.getAdapter.mock.results[0].value.submitPayload).not.toHaveBeenCalled();
  });

  test('moves an ambiguous transport outcome to needs review', async () => {
    submitRegistry.getAdapter.mockReturnValueOnce({
      provider: 'MERCHIZE', buildPayload: jest.fn(() => ({ order_id: 'stable' })),
      validatePayload: jest.fn(),
      submitPayload: jest.fn().mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })),
    });

    await expect(service.submitToVendor(submissionId, { dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], accountId: actorId,
    })).rejects.toMatchObject({ code: 'ECONNRESET' });

    expect(repository.transitionStatus).toHaveBeenCalledWith(
      submissionId,
      ['SUBMITTING'],
      expect.objectContaining({ status: 'NEEDS_REVIEW', failureReason: 'socket hang up' }),
    );
  });

  test('moves missing vendor credentials to failed without masking the validation error', async () => {
    vendorPublic.getVendorIntegrationCredential.mockResolvedValueOnce(null);

    await expect(service.submitToVendor(submissionId, { dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], accountId: actorId,
    })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(repository.transitionStatus).toHaveBeenCalledWith(
      submissionId,
      ['SUBMITTING'],
      expect.objectContaining({ status: 'FAILED', submittedResponse: null }),
    );
  });

  test('repairs production handoff for an already submitted submission without posting again', async () => {
    repository.findById.mockResolvedValueOnce({ ...submission, status: 'SUBMITTED' });

    const result = await service.submitToVendor(submissionId, { dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'], accountId: actorId,
    });

    expect(productionPublic.markSentToVendor).toHaveBeenCalled();
    expect(submitRegistry.getAdapter).not.toHaveBeenCalled();
    expect(result.status).toBe('SUBMITTED');
  });

  test('reconciles a remotely found order and repairs production handoff', async () => {
    repository.findById.mockResolvedValueOnce({ ...submission, status: 'NEEDS_REVIEW' });
    repository.transitionStatus.mockResolvedValueOnce({
      ...submission, status: 'SUBMITTED', vendorExternalOrderId: 'MZ-REMOTE-1',
    });

    const result = await service.reconcile(submissionId, {
      outcome: 'REMOTE_FOUND', vendorExternalOrderId: 'MZ-REMOTE-1', reason: 'Found in provider portal',
    }, { permissions: ['VENDOR_SUBMISSIONS:WRITE'], accountId: actorId });

    expect(repository.transitionStatus).toHaveBeenCalledWith(submissionId, ['NEEDS_REVIEW'], expect.objectContaining({
      status: 'SUBMITTED', vendorExternalOrderId: 'MZ-REMOTE-1',
    }));
    expect(productionPublic.markSentToVendor).toHaveBeenCalled();
    expect(result.status).toBe('SUBMITTED');
  });

  test('reconciles a confirmed missing remote order back to ready without posting', async () => {
    repository.findById.mockResolvedValueOnce({ ...submission, status: 'NEEDS_REVIEW' });
    repository.transitionStatus.mockResolvedValueOnce({ ...submission, status: 'READY', submitClaimedAt: null });

    const result = await service.reconcile(submissionId, {
      outcome: 'REMOTE_NOT_FOUND', reason: 'Provider lookup returned no order',
    }, { permissions: ['VENDOR_SUBMISSIONS:WRITE'], accountId: actorId });

    expect(result.status).toBe('READY');
    expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
  });

  test('submit to vendor posts payload, marks submission submitted, and calls production handoff', async () => {
    const result = await service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    const adapter = submitRegistry.getAdapter.mock.results[0].value;
    expect(adapter.submitPayload).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: '113-TEST-ORDER' }),
      expect.objectContaining({ idempotencyKey: `vendor-submission:${submissionId}` }),
    );
    expect(repository.transitionStatus).toHaveBeenCalledWith(submissionId, ['SUBMITTING'], expect.objectContaining({
      status: 'SUBMITTED',
      provider: 'MERCHIZE',
      vendorExternalOrderId: 'MZ-ORDER-1',
      submittedBy: actorId,
      submittedAt: expect.any(Date),
      submittedResponse: { success: true, data: { _id: 'MZ-ORDER-1' } },
    }));
    expect(productionPublic.markSentToVendor).toHaveBeenCalledWith(productionTaskId, submissionId, expect.objectContaining({
      accountId: actorId,
      auditActorType: 'ACCOUNT',
      auditSource: 'HTTP',
    }));
    expect(result).toMatchObject({
      status: 'SUBMITTED',
      provider: 'MERCHIZE',
      vendorExternalOrderId: 'MZ-ORDER-1',
    });
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VENDOR_SUBMISSION_SUBMITTED',
      metadata: { provider: 'MERCHIZE' },
    }), {});
    expect(JSON.stringify(auditPublic.record.mock.calls[0][0])).not.toContain('MZ-ORDER-1');
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

    expect(repository.transitionStatus).toHaveBeenCalledWith(submissionId, ['SUBMITTING'], expect.objectContaining({
      status: 'FAILED',
      provider: 'MERCHIZE',
      failedBy: actorId,
      failedAt: expect.any(Date),
      failureReason: 'Merchize rejected order',
      submittedResponse: { success: false, message: 'Invalid Merchize SKU' },
    }));
    expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VENDOR_SUBMISSION_FAILED',
      changes: expect.objectContaining({ reasonCode: 'VENDOR_SUBMIT_REJECTED' }),
    }), {});
    expect(JSON.stringify(auditPublic.record.mock.calls[0][0])).not.toContain('Invalid Merchize SKU');
  });

  test('quarantines an ambiguous provider transport failure for review', async () => {
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

    expect(repository.transitionStatus).toHaveBeenCalledWith(submissionId, ['SUBMITTING'], expect.objectContaining({
      status: 'NEEDS_REVIEW',
    }));
    expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
  });

  test('does not repost a submission that is already submitted', async () => {
    repository.findById.mockResolvedValueOnce({ ...submission, status: 'SUBMITTED' });

    await expect(service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    })).resolves.toMatchObject({ status: 'SUBMITTED' });

    expect(submitRegistry.getAdapter).not.toHaveBeenCalled();
    expect(productionPublic.markSentToVendor).toHaveBeenCalled();
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

    const patch = repository.transitionStatus.mock.calls[0][2];
    expect(patch.submittedResponse).toEqual({ success: true });
  });
});
