jest.mock('../../../modules/catalog/public', () => ({
  getInternalTemplateById: jest.fn(),
  getListingById: jest.fn(),
  setListingPsdTemplateAsset: jest.fn(),
}));

jest.mock('../../../modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/design/repositories/designTask.repository', () => ({
  create: jest.fn(),
  findActiveByListingAndType: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  updateById: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const catalogPublic = require('../../../modules/catalog/public');
const mediaPublic = require('../../../modules/media/public');
const repository = require('../../../modules/design/repositories/designTask.repository');
const service = require('../../../modules/design/services/designTask.service');

describe('designTask.service', () => {
  const taskId = '660000000000000000510001';
  const listingId = '660000000000000000510002';
  const shopId = '660000000000000000510003';
  const productTypeGroupId = '660000000000000000510004';
  const internalTemplateId = '660000000000000000510005';
  const accountId = '660000000000000000510006';
  const assetId = '660000000000000000510007';

  const listing = {
    _id: listingId,
    shopId,
    sku: 'SKU-1',
    title: 'Listing',
    productTypeGroupId,
    internalTemplateId,
    psdStatus: 'MISSING',
  };

  const template = {
    _id: internalTemplateId,
    code: 'SHIRT_MAIN',
    name: 'Shirt Main',
    status: 'ACTIVE',
  };

  const openTask = {
    _id: taskId,
    listingId,
    shopId,
    productTypeGroupId,
    internalTemplateId,
    taskType: 'PSD_TEMPLATE',
    status: 'OPEN',
    listingSnapshot: { id: listingId, sku: 'SKU-1', title: 'Listing' },
    internalTemplateSnapshot: { id: internalTemplateId, code: 'SHIRT_MAIN', name: 'Shirt Main', status: 'ACTIVE' },
    submittedAssetIds: [],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    catalogPublic.getListingById.mockResolvedValue(listing);
    catalogPublic.getInternalTemplateById.mockResolvedValue(template);
    catalogPublic.setListingPsdTemplateAsset.mockResolvedValue({ id: listingId, psdStatus: 'PRESENT' });
    mediaPublic.assertMediaAssetExists.mockResolvedValue({ _id: assetId });
    repository.findActiveByListingAndType.mockResolvedValue(null);
    repository.create.mockImplementation(async (payload) => ({ _id: taskId, ...payload }));
    repository.findById.mockResolvedValue(openTask);
    repository.updateById.mockImplementation(async (_id, patch) => ({ ...openTask, ...patch }));
  });

  test('creates task from listing and snapshots listing/template', async () => {
    const result = await service.createTask({
      listingId,
      taskType: 'PSD_TEMPLATE',
      note: 'Need PSD',
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      listingId,
      shopId,
      productTypeGroupId,
      internalTemplateId,
      taskType: 'PSD_TEMPLATE',
      status: 'OPEN',
      listingSnapshot: expect.objectContaining({ id: listingId, sku: 'SKU-1' }),
      internalTemplateSnapshot: expect.objectContaining({ id: internalTemplateId, code: 'SHIRT_MAIN' }),
    }));
    expect(result).toMatchObject({
      id: taskId,
      taskType: 'PSD_TEMPLATE',
      status: 'OPEN',
      listing: { id: listingId, sku: 'SKU-1' },
      internalTemplate: { id: internalTemplateId, code: 'SHIRT_MAIN' },
    });
  });

  test('duplicate active task for same listing and type returns conflict', async () => {
    repository.findActiveByListingAndType.mockResolvedValueOnce(openTask);

    await expect(service.createTask({
      listingId,
      taskType: 'PSD_TEMPLATE',
    }, { permissions: ['DESIGN:WRITE'] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  test('submit validates media assets and moves task to submitted', async () => {
    repository.findById.mockResolvedValueOnce({ ...openTask, status: 'IN_PROGRESS' });

    const result = await service.submitTask(taskId, {
      submittedAssetIds: [assetId],
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(assetId);
    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
      submittedBy: accountId,
      submittedAt: expect.any(Date),
    }));
    expect(result.status).toBe('SUBMITTED');
  });

  test('approve PSD template task updates listing PSD through catalog public', async () => {
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
    });

    const result = await service.approveTask(taskId, {
      approvedAssetId: assetId,
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(catalogPublic.setListingPsdTemplateAsset).toHaveBeenCalledWith(listingId, assetId, expect.objectContaining({
      source: 'DESIGN_TASK',
      accountId,
    }));
    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'APPROVED',
      approvedAssetId: assetId,
      approvedBy: accountId,
      approvedAt: expect.any(Date),
    }));
    expect(result.status).toBe('APPROVED');
  });

  test('reject requires reason and moves submitted task to rejected', async () => {
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
    });

    await expect(service.rejectTask(taskId, { rejectReason: '' }, { permissions: ['DESIGN:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    const result = await service.rejectTask(taskId, { rejectReason: 'Wrong file' }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'REJECTED',
      rejectReason: 'Wrong file',
      rejectedBy: accountId,
      rejectedAt: expect.any(Date),
    }));
    expect(result.status).toBe('REJECTED');
  });

  test('scoped user cannot access another shop task', async () => {
    authPublic.canAccessScope.mockReturnValueOnce(false);

    await expect(service.getTask(taskId, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });
});
