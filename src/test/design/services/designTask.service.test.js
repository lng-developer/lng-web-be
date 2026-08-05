jest.mock('../../../modules/catalog/public', () => ({
  getInternalTemplateById: jest.fn(),
  getListingById: jest.fn(),
  listListings: jest.fn(),
  setListingPsdTemplateAsset: jest.fn(),
}));

jest.mock('../../../modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  findAssetIdsByOriginalFilename: jest.fn(),
  getAsset: jest.fn(),
  getAssetsByIds: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  createOrRecheckTaskForOrderItem: jest.fn(),
  listPsdBlockedTasksByExternalOrderId: jest.fn(),
  listPsdBlockedTasksByListing: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/hr/public', () => ({
  listAssignableProfiles: jest.fn(),
  listEmployeeProfilesByAccountIds: jest.fn(),
}));

jest.mock('../../../modules/shop/public', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/design/repositories/designTask.repository', () => ({
  create: jest.fn(),
  findActiveByListingAndType: jest.fn(),
  findActiveListingIdsByType: jest.fn(),
  findById: jest.fn(),
  getWorkload: jest.fn(),
  countActiveByDesigner: jest.fn(),
  list: jest.fn(),
  listPsdFileLinks: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../../../modules/design/repositories/designSubmissionScore.repository', () => ({
  findBySubmissionIds: jest.fn(),
  listPsdScoreRows: jest.fn(),
}));

jest.mock('../../../modules/workScore/public', () => ({
  recordDesignSubmissionScore: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const hrPublic = require('../../../modules/hr/public');
const catalogPublic = require('../../../modules/catalog/public');
const mediaPublic = require('../../../modules/media/public');
const productionPublic = require('../../../modules/production/public');
const shopPublic = require('../../../modules/shop/public');
const repository = require('../../../modules/design/repositories/designTask.repository');
const scoreRepository = require('../../../modules/design/repositories/designSubmissionScore.repository');
const workScorePublic = require('../../../modules/workScore/public');
const service = require('../../../modules/design/services/designTask.service');

describe('designTask.service', () => {
  const taskId = '660000000000000000510001';
  const listingId = '660000000000000000510002';
  const shopId = '660000000000000000510003';
  const productTypeGroupId = '660000000000000000510004';
  const internalTemplateId = '660000000000000000510005';
  const accountId = '660000000000000000510006';
  const assetId = '660000000000000000510007';
  const thumbnailAssetId = '660000000000000000510008';
  const sourceListingId = '660000000000000000510012';

  function scopedShopAuth(account, permissions, scopedShopId = shopId) {
    return {
      accountId: account,
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: scopedShopId, permissions }],
    };
  }

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
    priority: 'NORMAL',
    status: 'OPEN',
    listingSnapshot: { id: listingId, sku: 'SKU-1', asin: 'B0TESTASIN', title: 'Listing', psdStatus: 'MISSING' },
    internalTemplateSnapshot: { id: internalTemplateId, code: 'SHIRT_MAIN', name: 'Shirt Main', status: 'ACTIVE' },
    referenceAssetIds: [],
    submittedAssetIds: [],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValue([{
      accountId,
      fullName: 'Design User',
      avatarUrl: 'https://example.test/avatar.png',
    }]);
    hrPublic.listAssignableProfiles.mockResolvedValue([{
      id: 'profile-id',
      accountId,
      fullName: 'Design User',
      avatarUrl: 'https://example.test/avatar.png',
    }]);
    catalogPublic.getListingById.mockResolvedValue(listing);
    catalogPublic.getInternalTemplateById.mockResolvedValue(template);
    catalogPublic.listListings.mockResolvedValue({
      items: [{ id: listingId, psdStatus: 'MISSING' }],
      pagination: { total: 1, page: 1, limit: 100 },
    });
    catalogPublic.setListingPsdTemplateAsset.mockResolvedValue({ id: listingId, psdStatus: 'PRESENT' });
    mediaPublic.assertMediaAssetExists.mockResolvedValue({ _id: assetId });
    mediaPublic.getAsset.mockResolvedValue({ _id: assetId, originalFilename: 'design.psd', mimeType: 'image/vnd.adobe.photoshop' });
    mediaPublic.findAssetIdsByOriginalFilename.mockResolvedValue([]);
    mediaPublic.getAssetsByIds.mockResolvedValue([{
      _id: assetId,
      originalFilename: 'design.psd',
      mimeType: 'image/vnd.adobe.photoshop',
      size: 2048,
      localPath: 'C:\\tmp\\secret\\design.psd',
      relativeStoragePath: 'private/design.psd',
      providerAssetId: 'provider/secret/design.psd',
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
    }, {
      _id: thumbnailAssetId,
      originalFilename: 'thumbnail.png',
      mimeType: 'image/png',
      size: 1024,
      localPath: 'C:\\tmp\\secret\\thumbnail.png',
      relativeStoragePath: 'private/thumbnail.png',
      providerAssetId: 'provider/secret/thumbnail.png',
      createdAt: new Date('2026-07-09T00:00:00.000Z'),
    }]);
    productionPublic.listPsdBlockedTasksByListing.mockResolvedValue([]);
    productionPublic.listPsdBlockedTasksByExternalOrderId.mockResolvedValue([]);
    productionPublic.createOrRecheckTaskForOrderItem.mockResolvedValue({ id: '660000000000000000510010' });
    shopPublic.findById.mockResolvedValue({ _id: shopId, name: 'Amazon US' });
    repository.findActiveByListingAndType.mockResolvedValue(null);
    repository.findActiveListingIdsByType.mockResolvedValue([]);
    repository.countActiveByDesigner.mockResolvedValue([{ assignedDesignerId: accountId, activeTaskCount: 3 }]);
    repository.create.mockImplementation(async (payload) => ({ _id: taskId, ...payload }));
    repository.findById.mockResolvedValue(openTask);
    scoreRepository.findBySubmissionIds.mockResolvedValue([]);
    workScorePublic.recordDesignSubmissionScore.mockResolvedValue(null);
    repository.getWorkload.mockResolvedValue({
      totals: { activeCount: 1, submittedCount: 0, approvedCount: 0, rejectedCount: 0, unassignedCount: 0 },
      byDesigner: [{ assignedDesignerId: accountId, totalActive: 1, oldestActiveTaskAt: new Date('2026-07-01T00:00:00.000Z') }],
    });
    repository.list.mockResolvedValue({
      items: [{
        ...openTask,
        assignedDesignerId: accountId,
        referenceAssetIds: [thumbnailAssetId],
        submittedAssetIds: [assetId],
        priority: 'HIGH',
      }],
      total: 1,
      page: 1,
      limit: 20,
    });
    repository.listPsdFileLinks.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    scoreRepository.listPsdScoreRows.mockResolvedValue({
      items: [],
      total: 0,
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
      status: 'REQUESTED',
      listingSnapshot: expect.objectContaining({ id: listingId, sku: 'SKU-1' }),
      internalTemplateSnapshot: expect.objectContaining({ id: internalTemplateId, code: 'SHIRT_MAIN' }),
    }));
    expect(result).toMatchObject({
      id: taskId,
      taskType: 'PSD_TEMPLATE',
      status: 'REQUESTED',
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
      status: 'REQUESTED',
      note: 'Need PSD',
    }));
    expect(created.status).toBe('REQUESTED');

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

  test('system context can create PSD task from production blocker without DESIGN permission', async () => {
    authPublic.canAccessScope.mockReturnValueOnce(false);

    const created = await service.createPsdTemplateTaskFromListing(listingId, { note: 'Auto PSD' }, {
      system: true,
      source: 'PRODUCTION',
      accountId,
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      listingId,
      taskType: 'PSD_TEMPLATE',
      status: 'REQUESTED',
      note: 'Auto PSD',
    }));
    expect(created.status).toBe('REQUESTED');
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

  test('submit validates media assets, creates next submission version, and moves task to submitted', async () => {
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'IN_PROGRESS',
      submissions: [{ version: 1, status: 'REJECTED', assetIds: ['660000000000000000510099'] }],
    });

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
      submissions: [
        expect.objectContaining({ version: 1, status: 'REJECTED', assetIds: ['660000000000000000510099'] }),
        {
          version: 2,
          status: 'SUBMITTED',
          assetIds: [assetId],
          submittedBy: accountId,
          submittedAt: expect.any(Date),
          note: null,
        },
      ],
    }));
    expect(result.status).toBe('SUBMITTED');
  });

  test('assign and cancel accept requested tasks', async () => {
    repository.findById.mockResolvedValueOnce({ ...openTask, status: 'REQUESTED' });
    await service.assignTask(taskId, { assignedDesignerId: accountId }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });
    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      assignedDesignerId: accountId,
      status: 'ASSIGNED',
    }));

    repository.updateById.mockClear();
    repository.findById.mockResolvedValueOnce({ ...openTask, status: 'REQUESTED' });
    await service.cancelTask(taskId, { cancelReason: 'No longer needed' }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });
    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'CANCELLED',
      cancelledBy: accountId,
    }));
  });

  test('approve PSD template task updates listing PSD through catalog public', async () => {
    const productionTaskId = '660000000000000000510010';
    const orderItemId = '660000000000000000510011';
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
      submissions: [{ _id: '660000000000000000510022', version: 2, status: 'SUBMITTED', assetIds: [assetId] }],
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

  test('approveTask scores the updated approved submission and returns its score', async () => {
    const submissionId = '660000000000000000510022';
    const score = {
      _id: '660000000000000000510023',
      taskId,
      submissionId,
      taskType: 'PSD_TEMPLATE',
      submissionVersion: 2,
      designerId: accountId,
      designerName: 'Design User',
      basePoints: 10,
      finalPoints: 10,
      scoreLevel: 'STANDARD',
      status: 'ACTIVE',
    };
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
      submissions: [{
        _id: submissionId,
        version: 2,
        status: 'SUBMITTED',
        assetIds: [assetId],
        submittedBy: accountId,
      }],
    });
    scoreRepository.findBySubmissionIds.mockResolvedValueOnce([score]);
    workScorePublic.recordDesignSubmissionScore.mockResolvedValueOnce({
      id: score._id,
      submissionId,
      finalPoints: score.finalPoints,
    });
    const authContext = { permissions: ['DESIGN:WRITE'], accountId };

    const result = await service.approveTask(taskId, { approvedAssetId: assetId }, authContext);

    expect(workScorePublic.recordDesignSubmissionScore).toHaveBeenCalledWith(expect.objectContaining({
      designTaskId: taskId,
      submissionId,
      assetId,
      shopId,
      workerId: accountId,
    }));
    expect(scoreRepository.findBySubmissionIds).toHaveBeenCalledWith([submissionId]);
    expect(result.approvedSubmission.score).toMatchObject({
      id: score._id,
      submissionId,
      finalPoints: 10,
    });
  });

  test('bulk assign keeps successful tasks when another task fails', async () => {
    const missingTaskId = '660000000000000000510013';
    repository.findById
      .mockResolvedValueOnce({ ...openTask, status: 'REQUESTED' })
      .mockResolvedValueOnce(null);

    const result = await service.bulkAssignTasks({
      taskIds: [taskId, missingTaskId],
      assignedDesignerId: accountId,
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(result.assigned).toHaveLength(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ taskId: missingTaskId, message: 'Design task not found' }),
    ]);
  });

  test('approveTask remains approved when Work Score creation fails', async () => {
    const submissionId = '660000000000000000510024';
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
      submissions: [{ _id: submissionId, version: 1, status: 'SUBMITTED', assetIds: [assetId], submittedBy: accountId }],
    });
    workScorePublic.recordDesignSubmissionScore.mockRejectedValueOnce(new Error('database unavailable'));

    const result = await service.approveTask(taskId, { approvedAssetId: assetId }, { permissions: ['DESIGN:WRITE'], accountId });

    expect(result.status).toBe('APPROVED');
    expect(result.warnings).toContainEqual({ code: 'SCORE_CREATION_FAILED' });
  });

  test('resolveActivePsdTaskForListing returns no-op when listing has no active PSD task', async () => {
    repository.findActiveByListingAndType.mockResolvedValueOnce(null);

    const result = await service.resolveActivePsdTaskForListing(listingId, assetId, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(assetId);
    expect(repository.findActiveByListingAndType).toHaveBeenCalledWith(listingId, 'PSD_TEMPLATE');
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(result).toEqual({ resolved: false, reason: 'NO_ACTIVE_TASK' });
  });

  test('resolveActivePsdTaskForListing approves active PSD task from listing upload', async () => {
    repository.findActiveByListingAndType.mockResolvedValueOnce({
      ...openTask,
      status: 'REQUESTED',
      submissions: [],
      submittedAssetIds: [],
    });

    const result = await service.resolveActivePsdTaskForListing(listingId, assetId, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'APPROVED',
      submittedAssetIds: [assetId],
      submittedBy: accountId,
      submittedAt: expect.any(Date),
      approvedAssetId: assetId,
      approvedBy: accountId,
      approvedAt: expect.any(Date),
      submissions: [expect.objectContaining({
        version: 1,
        assetIds: [assetId],
        status: 'APPROVED',
        approvedAssetId: assetId,
        approvedBy: accountId,
        approvedAt: expect.any(Date),
      })],
    }));
    expect(result).toEqual({ resolved: true, taskId, status: 'APPROVED' });
    expect(workScorePublic.recordDesignSubmissionScore).not.toHaveBeenCalled();
  });

  test('approve selected submission version and mirrors approved fields', async () => {
    const oldAssetId = '660000000000000000510099';
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
      submissions: [
        { _id: '660000000000000000510021', version: 1, status: 'REJECTED', assetIds: [oldAssetId] },
        { _id: '660000000000000000510022', version: 2, status: 'SUBMITTED', assetIds: [assetId] },
      ],
    });

    const result = await service.approveTask(taskId, {
      version: 2,
      approvedAssetId: assetId,
    }, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'APPROVED',
      approvedAssetId: assetId,
      approvedBy: accountId,
      submissions: [
        expect.objectContaining({ _id: '660000000000000000510021', version: 1, status: 'REJECTED', assetIds: [oldAssetId] }),
        expect.objectContaining({
          _id: '660000000000000000510022',
          version: 2,
          status: 'APPROVED',
          approvedAssetId: assetId,
          approvedBy: accountId,
          approvedAt: expect.any(Date),
        }),
      ],
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
      submissions: [{ _id: '660000000000000000510022', version: 2, status: 'SUBMITTED', assetIds: [assetId] }],
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
      submissions: [{ _id: '660000000000000000510022', version: 2, status: 'SUBMITTED', assetIds: [assetId] }],
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
      submissions: [expect.objectContaining({
        _id: '660000000000000000510022',
        version: 2,
        status: 'REJECTED',
        rejectReason: 'Wrong file',
        rejectedBy: accountId,
      })],
    }));
    expect(result.status).toBe('REJECTED');
  });

  test('removeSubmission marks unapproved submission as removed and rejects approved removal', async () => {
    const submissionId = '660000000000000000510022';
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      submissions: [{ _id: submissionId, version: 2, status: 'SUBMITTED', assetIds: [assetId] }],
    });

    await service.removeSubmission(taskId, submissionId, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      submissions: [expect.objectContaining({
        _id: submissionId,
        version: 2,
        status: 'REMOVED',
        removedBy: accountId,
        removedAt: expect.any(Date),
      })],
    }));

    repository.findById.mockResolvedValueOnce({
      ...openTask,
      submissions: [{ _id: submissionId, version: 2, status: 'APPROVED', assetIds: [assetId] }],
    });

    await expect(service.removeSubmission(taskId, submissionId, {
      permissions: ['DESIGN:WRITE'],
      accountId,
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
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

  test('shop-scoped DESIGN:WORK lists only own tasks in assigned shop', async () => {
    await service.listTasks({}, scopedShopAuth(accountId, ['DESIGN:WORK']));

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      assignedDesignerId: accountId,
      shopIds: [shopId],
    }));
  });

  test('shop-scoped DESIGN:REVIEW can read review queue and task detail', async () => {
    await service.listTasks({}, scopedShopAuth(accountId, ['DESIGN:REVIEW']));

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      shopIds: [shopId],
    }));

    repository.list.mockClear();
    const result = await service.getTask(taskId, scopedShopAuth(accountId, ['DESIGN:REVIEW']));

    expect(result).toMatchObject({ id: taskId, shopId });
  });

  test('listTasks applies UI filters and enriches task rows', async () => {
    productionPublic.listPsdBlockedTasksByListing.mockResolvedValueOnce([{
      id: '660000000000000000510010',
      orderItemId: '660000000000000000510011',
      externalOrderId: '111-7980434-4279402',
      blockers: ['PSD_MISSING'],
    }]);

    const result = await service.listTasks({
      sellerId: shopId,
      search: 'B0TESTASIN',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-14',
      priority: 'HIGH',
      psdStatus: 'MISSING',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    }, {
      permissions: ['DESIGN:READ'],
      accountId,
    });

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      search: 'B0TESTASIN',
      priority: 'HIGH',
      psdStatus: 'MISSING',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    }));
    expect(hrPublic.listEmployeeProfilesByAccountIds).toHaveBeenCalledWith([accountId]);
    expect(shopPublic.findById).toHaveBeenCalledWith(shopId);
    expect(mediaPublic.getAssetsByIds).toHaveBeenCalledWith([thumbnailAssetId, assetId]);
    expect(productionPublic.listPsdBlockedTasksByListing).toHaveBeenCalledWith(listingId);
    expect(result.items[0]).toMatchObject({
      externalOrderId: '111-7980434-4279402',
      priority: 'HIGH',
      assignedDesigner: {
        id: accountId,
        fullName: 'Design User',
        avatarUrl: 'https://example.test/avatar.png',
      },
      shop: { id: shopId, name: 'Amazon US' },
      seller: { id: shopId, name: 'Amazon US' },
      asinType: 'NORMAL',
      latestSubmittedAsset: {
        id: assetId,
        originalFilename: 'design.psd',
        mimeType: 'image/vnd.adobe.photoshop',
        size: 2048,
        downloadUrl: `/api/media/assets/${assetId}/download`,
      },
      thumbnailAsset: {
        id: thumbnailAssetId,
        originalFilename: 'thumbnail.png',
        mimeType: 'image/png',
        size: 1024,
        downloadUrl: `/api/media/assets/${thumbnailAssetId}/download`,
      },
      hasActivePsdTask: true,
    });
    expect(Object.prototype.hasOwnProperty.call(result.items[0].latestSubmission, 'score')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('localPath');
    expect(JSON.stringify(result)).not.toContain('relativeStoragePath');
    expect(JSON.stringify(result)).not.toContain('providerAssetId');
  });

  test('lists PSD score records with Auth-resolved scorer and automated fallback', async () => {
    scoreRepository.listPsdScoreRows.mockResolvedValue({
      items: [{
        _id: '660000000000000000510024',
        task: openTask,
        submissionId: '660000000000000000510022',
        submissionVersion: 2,
        assetId,
        designerId: accountId,
        designerName: 'Design User',
        finalPoints: 3,
        scoreLevel: 'STANDARD',
        status: 'ACTIVE',
        scoredBy: accountId,
      }, {
        _id: '660000000000000000510025',
        task: openTask,
        submissionId: '660000000000000000510023',
        submissionVersion: 3,
        assetId,
        designerId: accountId,
        designerName: 'Design User',
        finalPoints: 3,
        scoreLevel: 'STANDARD',
        status: 'ACTIVE',
        scoredBy: null,
      }],
      total: 2,
      page: 1,
      limit: 20,
    });
    mediaPublic.getAssetsByIds.mockResolvedValue([{
      _id: assetId,
      originalFilename: 'master.psd',
      mimeType: 'application/octet-stream',
      size: 1024,
      relativeStoragePath: 'private/master.psd',
    }]);

    const result = await service.listSubmissionScores({}, {
      permissions: ['DESIGN:READ'],
      accountId,
    });

    expect(scoreRepository.listPsdScoreRows).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'PSD_TEMPLATE' }),
    );
    expect(result.items[0].file).toEqual(
      expect.objectContaining({ originalFilename: 'master.psd', size: 1024 }),
    );
    expect(result.items.map((item) => item.score.scorer)).toEqual([
      { id: accountId, name: 'Design User' },
      { id: null, name: 'Automated' },
    ]);
    expect(hrPublic.listEmployeeProfilesByAccountIds).toHaveBeenCalledWith([accountId]);
    expect(JSON.stringify(result)).not.toContain('relativeStoragePath');
  });

  test('lists PSD file links through scoped shops and maps only PSD task rows', async () => {
    const submissionId = '660000000000000000510022';
    repository.listPsdFileLinks.mockResolvedValue({
      items: [{
        ...openTask,
        fileLinks: {
          assetId,
          role: 'SUBMISSION',
          submissionId,
          version: 2,
          linkedAt: new Date('2026-07-11T00:00:00.000Z'),
        },
        assignedDesignerId: accountId,
      }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const result = await service.listPsdFiles(
      { search: ' master ', designerId: accountId },
      scopedShopAuth(accountId, ['DESIGN:READ']),
    );

    expect(mediaPublic.findAssetIdsByOriginalFilename).toHaveBeenCalledWith('master');
    expect(repository.listPsdFileLinks).toHaveBeenCalledWith(expect.objectContaining({
      assignedDesignerId: accountId,
      matchingAssetIds: [],
      shopIds: [shopId],
      taskType: 'PSD_TEMPLATE',
    }));
    expect(result.items).toEqual([
      expect.objectContaining({
        rowKey: `${assetId}:${taskId}:SUBMISSION:${submissionId}`,
        linkedAt: new Date('2026-07-11T00:00:00.000Z'),
        asset: expect.objectContaining({
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          downloadUrl: `/api/media/assets/${assetId}/download`,
        }),
        designer: { id: accountId, name: 'Design User' },
        task: expect.objectContaining({ taskType: 'PSD_TEMPLATE' }),
      }),
    ]);
    expect(hrPublic.listEmployeeProfilesByAccountIds).toHaveBeenCalledWith([accountId]);
    expect(result.items.every((row) => row.task.taskType === 'PSD_TEMPLATE')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('relativeStoragePath');
  });

  test('listTasks filters by external order id through production readiness', async () => {
    productionPublic.listPsdBlockedTasksByExternalOrderId.mockResolvedValueOnce([{
      id: '660000000000000000510010',
      listingId,
      orderItemId: '660000000000000000510011',
      externalOrderId: '111-7980434-4279402',
      blockers: ['PSD_MISSING'],
    }]);

    await service.listTasks({ orderId: '111-7980434-4279402' }, {
      permissions: ['DESIGN:READ'],
      accountId,
    });

    expect(productionPublic.listPsdBlockedTasksByExternalOrderId)
      .toHaveBeenCalledWith('111-7980434-4279402');
    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      listingIds: [listingId],
    }));
  });

  test('getTask returns submission history with synthetic fallback for old submitted tasks', async () => {
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'SUBMITTED',
      submittedAssetIds: [assetId],
      submittedBy: accountId,
      submittedAt: new Date('2026-07-10T00:00:00.000Z'),
    });

    const result = await service.getTask(taskId, {
      permissions: ['DESIGN:READ'],
      accountId,
    });

    expect(result).toMatchObject({
      submissionCount: 1,
      latestSubmission: {
        version: 1,
        status: 'SUBMITTED',
        assetIds: [assetId],
        assets: [expect.objectContaining({
          id: assetId,
          originalFilename: 'design.psd',
          downloadUrl: `/api/media/assets/${assetId}/download`,
        })],
      },
      submissions: [{
        version: 1,
        status: 'SUBMITTED',
        assetIds: [assetId],
        score: null,
      }],
    });
    expect(result.latestSubmission).toHaveProperty('score', null);
  });

  test('loads submission scores for detail responses but not task lists', async () => {
    const submissionId = '660000000000000000510022';
    const taskWithSubmission = {
      ...openTask,
      status: 'APPROVED',
      submissions: [{ _id: submissionId, version: 1, status: 'APPROVED', assetIds: [assetId], submittedBy: accountId }],
    };
    repository.findById.mockResolvedValue(taskWithSubmission);

    await service.listTasks({}, { permissions: ['DESIGN:READ'], accountId });
    expect(scoreRepository.findBySubmissionIds).not.toHaveBeenCalled();

    await service.getTask(taskId, { permissions: ['DESIGN:READ'], accountId });
    expect(scoreRepository.findBySubmissionIds).toHaveBeenCalledWith([submissionId]);

    scoreRepository.findBySubmissionIds.mockClear();
    await service.listSubmissions(taskId, { permissions: ['DESIGN:READ'], accountId });
    expect(scoreRepository.findBySubmissionIds).toHaveBeenCalledWith([submissionId]);
  });

  test('submission detail maps the score to its matching submission id', async () => {
    const firstSubmissionId = '660000000000000000510022';
    const secondSubmissionId = '660000000000000000510023';
    repository.findById.mockResolvedValueOnce({
      ...openTask,
      status: 'APPROVED',
      submissions: [
        { _id: firstSubmissionId, version: 1, status: 'REJECTED', assetIds: [assetId], submittedBy: accountId },
        { _id: secondSubmissionId, version: 2, status: 'APPROVED', assetIds: [assetId], submittedBy: accountId },
      ],
    });
    scoreRepository.findBySubmissionIds.mockResolvedValueOnce([{
      _id: '660000000000000000510024',
      taskId,
      submissionId: secondSubmissionId,
      taskType: 'PSD_TEMPLATE',
      submissionVersion: 2,
      designerId: accountId,
      finalPoints: 15,
      scoreLevel: 'HARD',
      status: 'ACTIVE',
    }]);

    const result = await service.getTask(taskId, { permissions: ['DESIGN:READ'], accountId });

    expect(result.submissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstSubmissionId, score: null }),
      expect.objectContaining({
        id: secondSubmissionId,
        score: expect.objectContaining({ finalPoints: 15, scoreLevel: 'HARD' }),
      }),
    ]));
  });

  test('getAssignees returns assignable account ids with active task counts', async () => {
    const result = await service.getAssignees({ taskType: 'PSD_TEMPLATE' }, {
      permissions: ['DESIGN:READ'],
    });

    expect(hrPublic.listAssignableProfiles).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    expect(repository.countActiveByDesigner).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'PSD_TEMPLATE',
    }));
    expect(result.items).toEqual([{
      id: accountId,
      fullName: 'Design User',
      avatarUrl: 'https://example.test/avatar.png',
      activeTaskCount: 3,
    }]);
  });

  test('listPsdTemplateCandidates excludes listings with active PSD tasks', async () => {
    const blockedListingId = '660000000000000000510099';
    catalogPublic.listListings.mockResolvedValueOnce({
      items: [
        { id: listingId, sku: 'SKU-1', psdStatus: 'MISSING' },
        { id: blockedListingId, sku: 'SKU-2', psdStatus: 'MISSING' },
      ],
      pagination: { total: 2, page: 1, limit: 20 },
    });
    repository.findActiveListingIdsByType.mockResolvedValueOnce([blockedListingId]);

    const result = await service.listPsdTemplateCandidates({
      sellerId: shopId,
      search: 'SKU',
      page: 1,
      limit: 20,
    }, {
      permissions: ['DESIGN:READ'],
    });

    expect(catalogPublic.listListings).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      search: 'SKU',
      psdStatus: 'MISSING',
      page: 1,
      limit: 20,
    }), expect.objectContaining({ system: true, source: 'DESIGN' }));
    expect(repository.findActiveListingIdsByType).toHaveBeenCalledWith([listingId, blockedListingId], 'PSD_TEMPLATE');
    expect(result.items).toEqual([expect.objectContaining({
      id: listingId,
      sku: 'SKU-1',
      hasActivePsdTask: false,
    })]);
    expect(result.pagination).toMatchObject({ total: 1, page: 1, limit: 20 });
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
