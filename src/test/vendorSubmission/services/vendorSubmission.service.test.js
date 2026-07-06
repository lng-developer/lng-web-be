jest.mock('../../../modules/production/public', () => ({
  getTaskById: jest.fn(),
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
  list: jest.fn(),
  updateById: jest.fn(),
}));

const productionPublic = require('../../../modules/production/public');
const authPublic = require('../../../modules/auth/public');
const repository = require('../../../modules/vendorSubmission/repositories/vendorSubmission.repository');
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
    productionPublic.markSentToVendor.mockResolvedValue({ id: productionTaskId, status: 'SENT_TO_VENDOR' });
    authPublic.canAccessScope.mockReturnValue(true);
    repository.findActiveByProductionTask.mockResolvedValue(null);
    repository.create.mockResolvedValue(submission);
    repository.findById.mockResolvedValue(submission);
    repository.updateById.mockImplementation(async (_id, patch) => ({ ...submission, ...patch }));
  });

  test('creates a ready submission from a ready production task and stores safe snapshot', async () => {
    const result = await service.createFromProductionTask(productionTaskId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(productionPublic.getTaskById).toHaveBeenCalledWith(productionTaskId);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      productionTaskId,
      orderId,
      orderItemId,
      shopId,
      fulfillmentPlanId,
      vendorProductId,
      vendorCostCenterId,
      status: 'READY',
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

  test('mark submitted updates submission and calls production handoff', async () => {
    const result = await service.markSubmitted(submissionId, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      status: 'SUBMITTED',
      submittedBy: actorId,
      submittedAt: expect.any(Date),
    }));
    expect(productionPublic.markSentToVendor).toHaveBeenCalledWith(productionTaskId, submissionId, expect.objectContaining({
      accountId: actorId,
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

  test('cancel does not call production status update', async () => {
    const result = await service.cancel(submissionId, { cancelReason: 'Duplicate' }, {
      permissions: ['VENDOR_SUBMISSIONS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({
      status: 'CANCELLED',
      cancelledBy: actorId,
      cancelReason: 'Duplicate',
    }));
    expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
    expect(result.status).toBe('CANCELLED');
  });
});
