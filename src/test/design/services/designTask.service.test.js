jest.mock('../../../modules/catalog/public', () => ({
  getInternalTemplateById: jest.fn(),
  getListingById: jest.fn(),
  listListings: jest.fn(),
  setListingPsdTemplateAsset: jest.fn(),
}));

jest.mock('../../../modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  getAsset: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  createOrRecheckTaskForOrderItem: jest.fn(),
  listPsdBlockedTasksByListing: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/design/repositories/designTask.repository', () => ({
  create: jest.fn(),
  findActiveByListingAndType: jest.fn(),
  findById: jest.fn(),
  getWorkload: jest.fn(),
  list: jest.fn(),
  updateById: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const catalogPublic = require('../../../modules/catalog/public');
const mediaPublic = require('../../../modules/media/public');
const productionPublic = require('../../../modules/production/public');
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
  const sourceListingId = '660000000000000000510012';

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
    catalogPublic.listListings.mockResolvedValue({
      items: [{ id: listingId, psdStatus: 'MISSING' }],
      pagination: { total: 1, page: 1, limit: 100 },
    });
    catalogPublic.setListingPsdTemplateAsset.mockResolvedValue({ id: listingId, psdStatus: 'PRESENT' });
    mediaPublic.assertMediaAssetExists.mockResolvedValue({ _id: assetId });
    mediaPublic.getAsset.mockResolvedValue({ _id: assetId, originalFilename: 'design.psd', mimeType: 'image/vnd.adobe.photoshop' });
    productionPublic.listPsdBlockedTasksByListing.mockResolvedValue([]);
    productionPublic.createOrRecheckTaskForOrderItem.mockResolvedValue({ id: '660000000000000000510010' });
    repository.findActiveByListingAndType.mockResolvedValue(null);
    repository.create.mockImplementation(async (payload) => ({ _id: taskId, ...payload }));
    repository.findById.mockResolvedValue(openTask);
    repository.getWorkload.mockResolvedValue({
      totals: { activeCount: 1, submittedCount: 0, approvedCount: 0, rejectedCount: 0, unassignedCount: 0 },
      byDesigner: [{ assignedDesignerId: accountId, totalActive: 1, oldestActiveTaskAt: new Date('2026-07-01T00:00:00.000Z') }],
    });
    repository.list.mockResolvedValue({
      items: [{ ...openTask, assignedDesignerId: accountId }],
      total: 1,
      page: 1,
      limit: 20,
    });
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

  test('IDEA task requires brief and stores reference assets', async () => {
    await expect(service.createTask({
      listingId,
      taskType: 'IDEA',
    }, { permissions: ['DESIGN:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });

    const result = await service.createTask({
      listingId,
      taskType: 'IDEA',
      brief: 'Create a graduation shirt idea',
      referenceAssetIds: [assetId, assetId],
      expectedOutputs: ['MOCKUP', 'PNG_ASSET'],
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(assetId);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'IDEA',
      brief: 'Create a graduation shirt idea',
      referenceAssetIds: [assetId],
      expectedOutputs: ['MOCKUP', 'PNG_ASSET'],
      targetListingId: listingId,
    }));
    expect(result).toMatchObject({
      taskType: 'IDEA',
      brief: 'Create a graduation shirt idea',
      referenceAssetCount: 1,
    });
  });

  test('CLONE task requires source listing or template and validates source listing access', async () => {
    await expect(service.createTask({
      listingId,
      taskType: 'CLONE',
    }, { permissions: ['DESIGN:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });

    const sourceListing = {
      ...listing,
      _id: sourceListingId,
      sku: 'SOURCE-SKU',
    };
    catalogPublic.getListingById
      .mockResolvedValueOnce(listing)
      .mockResolvedValueOnce(sourceListing);

    const result = await service.createTask({
      listingId,
      taskType: 'CLONE',
      sourceListingId,
      brief: 'Clone source design for this target listing',
      expectedOutputs: ['PSD_TEMPLATE'],
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(catalogPublic.getListingById).toHaveBeenCalledWith(sourceListingId);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'CLONE',
      sourceListingId,
      expectedOutputs: ['PSD_TEMPLATE'],
    }));
    expect(result).toMatchObject({
      taskType: 'CLONE',
      sourceListingId,
      expectedOutputs: ['PSD_TEMPLATE'],
    });
  });

  test('creates PSD task from missing-PSD listing and returns existing active task idempotently', async () => {
    const created = await service.createPsdTemplateTaskFromListing(listingId, { note: 'Need PSD' }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      listingId,
      taskType: 'PSD_TEMPLATE',
      status: 'OPEN',
      note: 'Need PSD',
    }));
    expect(created.status).toBe('OPEN');

    jest.clearAllMocks();
    catalogPublic.getListingById.mockResolvedValue(listing);
    repository.findActiveByListingAndType.mockResolvedValue(openTask);

    const existing = await service.createPsdTemplateTaskFromListing(listingId, {}, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(repository.create).not.toHaveBeenCalled();
    expect(existing).toMatchObject({ id: taskId, taskType: 'PSD_TEMPLATE', status: 'OPEN' });
  });

  test('create PSD task helper rejects listing whose PSD is already present', async () => {
    catalogPublic.getListingById.mockResolvedValueOnce({ ...listing, psdStatus: 'PRESENT' });

    await expect(service.createPsdTemplateTaskFromListing(listingId, {}, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  test('bulk creates PSD tasks from listing ids idempotently', async () => {
    const existingTask = {
      ...openTask,
      _id: '660000000000000000510099',
      listingId: '660000000000000000510099',
    };
    catalogPublic.getListingById
      .mockResolvedValueOnce(listing)
      .mockResolvedValueOnce({ ...listing, _id: '660000000000000000510099' });
    repository.findActiveByListingAndType
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingTask);

    const result = await service.bulkCreatePsdTasksFromListings({
      listingIds: [listingId, '660000000000000000510099'],
      note: 'Need PSD',
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(result).toMatchObject({
      checked: 2,
      created: 1,
      existing: 1,
      skipped: 0,
    });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ listingId, status: 'CREATED', taskId }),
      expect.objectContaining({ listingId: '660000000000000000510099', status: 'EXISTING' }),
    ]));
  });

  test('bulk creates PSD tasks from filters and skips listings with PSD present', async () => {
    catalogPublic.listListings.mockResolvedValueOnce({
      items: [
        { id: listingId, psdStatus: 'MISSING' },
        { id: '660000000000000000510099', psdStatus: 'PRESENT' },
      ],
      pagination: { total: 2, page: 1, limit: 100 },
    });
    catalogPublic.getListingById
      .mockResolvedValueOnce(listing)
      .mockResolvedValueOnce({ ...listing, _id: '660000000000000000510099', psdStatus: 'PRESENT' });

    const result = await service.bulkCreatePsdTasksFromListings({
      filters: { shopId },
      limit: 150,
      note: 'Need PSD',
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(catalogPublic.listListings).toHaveBeenCalledWith({
      shopId,
      psdStatus: 'MISSING',
      page: 1,
      limit: 100,
    }, expect.objectContaining({ permissions: ['DESIGN:WRITE'] }));
    expect(result).toMatchObject({
      checked: 2,
      created: 1,
      existing: 0,
      skipped: 1,
    });
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
    const productionTaskId = '660000000000000000510010';
    const orderItemId = '660000000000000000510011';
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
    });
    productionPublic.listPsdBlockedTasksByListing.mockResolvedValueOnce([{
      id: productionTaskId,
      orderItemId,
      blockers: ['PSD_MISSING'],
    }]);

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
    expect(productionPublic.createOrRecheckTaskForOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      system: true,
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

  test('approve CLONE PSD output updates target listing PSD through catalog public', async () => {
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      taskType: 'CLONE',
      status: 'SUBMITTED',
      targetListingId: listingId,
      sourceListingId,
      expectedOutputs: ['PSD_TEMPLATE'],
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
    expect(result.status).toBe('APPROVED');
  });

  test('approve CLONE PSD-like asset updates target listing even without expected PSD output', async () => {
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      taskType: 'CLONE',
      status: 'SUBMITTED',
      targetListingId: listingId,
      sourceListingId,
      expectedOutputs: ['MOCKUP'],
      submittedAssetIds: [assetId],
    });

    const result = await service.approveTask(taskId, {
      approvedAssetId: assetId,
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(mediaPublic.getAsset).toHaveBeenCalledWith(assetId);
    expect(catalogPublic.setListingPsdTemplateAsset).toHaveBeenCalledWith(listingId, assetId, expect.any(Object));
    expect(result.status).toBe('APPROVED');
  });

  test('approve IDEA does not update catalog PSD', async () => {
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      taskType: 'IDEA',
      brief: 'Explore trend',
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
    });

    const result = await service.approveTask(taskId, {
      approvedAssetId: assetId,
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(catalogPublic.setListingPsdTemplateAsset).not.toHaveBeenCalled();
    expect(productionPublic.listPsdBlockedTasksByListing).not.toHaveBeenCalled();
    expect(result.status).toBe('APPROVED');
  });

  test('approve keeps task approved and returns warning when production recheck fails', async () => {
    const orderItemId = '660000000000000000510011';
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
    });
    productionPublic.listPsdBlockedTasksByListing.mockResolvedValueOnce([{
      id: '660000000000000000510010',
      orderItemId,
      blockers: ['PSD_MISSING'],
    }]);
    productionPublic.createOrRecheckTaskForOrderItem.mockRejectedValueOnce(new Error('not ready'));

    const result = await service.approveTask(taskId, { approvedAssetId: assetId }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(result.status).toBe('APPROVED');
    expect(result.warnings).toEqual([expect.objectContaining({
      code: 'PRODUCTION_RECHECK_FAILED',
      orderItemId,
      message: 'not ready',
    })]);
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

  test('DESIGN:WORK lists only tasks assigned to current account', async () => {
    const result = await service.listTasks({}, {
      permissions: ['DESIGN:WORK'],
      accountId,
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      assignedDesignerId: accountId,
    }));
    expect(result.pagination.total).toBe(1);
  });

  test('DESIGN:WORK cannot read or submit another designer task', async () => {
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'IN_PROGRESS',
      assignedDesignerId: '660000000000000000519999',
    });

    await expect(service.getTask(taskId, {
      permissions: ['DESIGN:WORK'],
      accountId,
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'IN_PROGRESS',
      assignedDesignerId: '660000000000000000519999',
    });
    await expect(service.submitTask(taskId, {
      submittedAssetIds: [assetId],
    }, {
      permissions: ['DESIGN:WORK'],
      accountId,
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });

  test('DESIGN:REVIEW can approve submitted task without DESIGN:WRITE', async () => {
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
    });

    const result = await service.approveTask(taskId, { approvedAssetId: assetId }, {
      permissions: ['DESIGN:REVIEW'],
      accountId,
    });

    expect(result.status).toBe('APPROVED');
  });

  test('workload uses own-task filter for DESIGN:WORK', async () => {
    const result = await service.getWorkload({ taskType: 'PSD_TEMPLATE' }, {
      permissions: ['DESIGN:WORK'],
      accountId,
    });

    expect(repository.getWorkload).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'PSD_TEMPLATE',
      assignedDesignerId: accountId,
    }));
    expect(result.byDesigner).toHaveLength(1);
  });
});
