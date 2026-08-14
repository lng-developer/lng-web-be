jest.mock('../../../src/modules/production/models/productionTask.model', () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

const ProductionTask = require('../../../src/modules/production/models/productionTask.model');
const repository = require('../../../src/modules/production/repositories/productionTask.repository');

describe('productionTask.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockFind(items = []) {
    const chain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(items),
    };
    ProductionTask.find.mockReturnValue(chain);
    ProductionTask.countDocuments.mockResolvedValue(items.length);
    return chain;
  }

  test('list builds filters, search query, and pagination', async () => {
    const chain = mockFind([{ _id: 'task-1' }]);

    const result = await repository.list({
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      salesChannelCode: 'AMAZON',
      blocker: 'SCALED_OUTPUT_MISSING',
      designAssignmentStatus: 'UNASSIGNED',
      assignedDesignUserId: null,
      csStatus: 'UNASSIGNED',
      csUnassigned: true,
      shopId: '660000000000000000000201',
      search: 'J2605',
      page: 2,
      limit: 10,
    });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      'orderItemSnapshot.salesChannelCode': 'AMAZON',
      blockers: 'SCALED_OUTPUT_MISSING',
      assignedDesignUserId: null,
      csAssigneeId: null,
      csStatus: 'UNASSIGNED',
      shopId: '660000000000000000000201',
      $or: expect.arrayContaining([
        { 'orderItemSnapshot.externalOrderId': expect.any(RegExp) },
        { 'orderItemSnapshot.externalItemId': expect.any(RegExp) },
        { 'orderItemSnapshot.sku': expect.any(RegExp) },
        { 'orderItemSnapshot.asin': expect.any(RegExp) },
        { 'orderItemSnapshot.title': expect.any(RegExp) },
      ]),
    }));
    expect(chain.sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(chain.skip).toHaveBeenCalledWith(10);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(result).toEqual({ items: [{ _id: 'task-1' }], total: 1, page: 2, limit: 10 });
  });

  test('list filters seller code and failed tab without losing search', async () => {
    mockFind([]);

    await repository.list({
      sellerCode: 'J2605',
      tab: 'FAILED',
      search: 'ORDER-1',
    });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      'orderItemSnapshot.sku': expect.any(RegExp),
      $and: expect.arrayContaining([
        { $or: expect.arrayContaining([{ status: 'QC_REJECTED' }, { status: 'CANCELLED' }]) },
        { $or: expect.arrayContaining([{ 'orderItemSnapshot.externalOrderId': expect.any(RegExp) }]) },
      ]),
    }));
  });

  test('list maps address invalid tab to order address status', async () => {
    mockFind([]);

    await repository.list({ tab: 'ADDRESS_INVALID' });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      'orderSnapshot.addressValidationStatus': 'INVALID',
    }));
  });

  test('updates scaled output only while the task is mutable', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'task-1', status: 'QC_PENDING' });
    ProductionTask.findOneAndUpdate.mockReturnValue({ lean });

    const result = await repository.updateScaledOutputIfMutable('task-1', {
      fileChecks: [],
      status: 'QC_PENDING',
    });

    expect(ProductionTask.findOneAndUpdate).toHaveBeenCalledWith({
      _id: 'task-1',
      status: { $nin: ['READY_TO_SEND_VENDOR', 'SENT_TO_VENDOR', 'CANCELLED'] },
      qcStatus: { $ne: 'PASSED' },
    }, {
      $set: { fileChecks: [], status: 'QC_PENDING' },
    }, {
      returnDocument: 'after',
      runValidators: true,
    });
    expect(result).toEqual({ _id: 'task-1', status: 'QC_PENDING' });
  });

  test('findByOrderItem joins the caller transaction', async () => {
    const session = {};
    const query = {
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'task-1' }),
    };
    ProductionTask.findOne.mockReturnValue(query);

    await repository.findByOrderItem('item-1', { session });

    expect(query.session).toHaveBeenCalledWith(session);
  });

  test.each([
    [{ value: { _id: 'task-1' }, lastErrorObject: { updatedExisting: false } }, true],
    [{ value: { _id: 'task-1' }, lastErrorObject: { updatedExisting: true } }, false],
  ])('reports whether an order-item upsert created the task', async (metadata, created) => {
    const lean = jest.fn().mockResolvedValue(metadata);
    ProductionTask.findOneAndUpdate.mockReturnValue({ lean });

    const result = await repository.upsertByOrderItemWithResult(
      'item-1',
      { orderSnapshot: { status: 'PROCESSING' } },
      { setOnInsert: { status: 'NEED_SCALE', designNote: null } },
    );

    expect(ProductionTask.findOneAndUpdate).toHaveBeenCalledWith(
      { orderItemId: 'item-1' },
      {
        $set: { orderSnapshot: { status: 'PROCESSING' } },
        $setOnInsert: { status: 'NEED_SCALE', designNote: null },
      },
      expect.objectContaining({
        upsert: true,
        returnDocument: 'after',
        includeResultMetadata: true,
      }),
    );
    expect(result).toEqual({ task: { _id: 'task-1' }, created });
  });

  test('appends one file check only when the task is mutable and the slot is absent', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'task-1' });
    ProductionTask.findOneAndUpdate.mockReturnValue({ lean });
    const fileCheck = { slotKey: 'FRONT', qcStatus: 'NOT_READY' };

    await repository.appendFileCheckIfMutable('task-1', fileCheck);

    expect(ProductionTask.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'task-1',
        'fileChecks.slotKey': { $ne: 'FRONT' },
        qcStatus: { $ne: 'PASSED' },
      }),
      { $push: { fileChecks: fileCheck } },
      expect.objectContaining({ returnDocument: 'after', runValidators: true }),
    );
  });

  test('updates one file check only when its authoritative snapshot still matches', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'task-1' });
    ProductionTask.findOneAndUpdate.mockReturnValue({ lean });
    const expected = { outputAssetId: 'old', scaleStatus: 'SCALED', qcStatus: 'PENDING' };
    const patch = { outputAssetId: 'new', qcStatus: 'PENDING' };

    await repository.updateFileCheckOutputIfMutable('task-1', 'check-1', expected, patch);

    expect(ProductionTask.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'task-1',
        fileChecks: { $elemMatch: expect.objectContaining({ _id: 'check-1', ...expected }) },
        qcStatus: { $ne: 'PASSED' },
      }),
      { $set: { 'fileChecks.$[check].outputAssetId': 'new', 'fileChecks.$[check].qcStatus': 'PENDING' } },
      expect.objectContaining({
        arrayFilters: [{ 'check._id': 'check-1' }],
        returnDocument: 'after',
        runValidators: true,
      }),
    );
  });

  test('summarize returns status, assignment, and channel count maps', async () => {
    ProductionTask.aggregate.mockResolvedValueOnce([
      {
        totals: [{
          total: 5,
          unassigned: 1,
          assigned: 4,
          blocked: 1,
          needScale: 2,
          qcPending: 1,
          scaleQueue: 3,
          qcQueue: 1,
          readyToSendVendor: 1,
          addressInvalid: 0,
          failed: 0,
          csUnassigned: 2,
          csAssigned: 3,
        }],
        blockers: [{ _id: 'SCALED_OUTPUT_MISSING', count: 2 }],
        scaleStatuses: [{ _id: 'NEED_SCALE', count: 2 }, { _id: 'SCALED', count: 3 }],
        qcStatuses: [{ _id: 'NOT_READY', count: 2 }, { _id: 'PASSED', count: 3 }],
        assignmentStatuses: [{ _id: 'UNASSIGNED', count: 1 }, { _id: 'ASSIGNED', count: 2 }, { _id: 'OUTPUT_UPLOADED', count: 2 }],
        csStatuses: [{ _id: 'UNASSIGNED', count: 2 }, { _id: 'DONE', count: 3 }],
        salesChannels: [{ _id: 'AMAZON', count: 4 }, { _id: 'ETSY', count: 1 }],
      },
    ]);

    const result = await repository.summarize({ salesChannelCode: 'AMAZON' });

    expect(ProductionTask.countDocuments).not.toHaveBeenCalled();
    expect(ProductionTask.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $match: expect.objectContaining({ 'orderItemSnapshot.salesChannelCode': 'AMAZON' }) },
    ]));
    expect(result).toMatchObject({
      total: 5,
      scaleQueue: 3,
      qcQueue: 1,
      byScaleStatus: { NEED_SCALE: 2, SCALED: 3 },
      byQcStatus: { NOT_READY: 2, PASSED: 3 },
      byAssignmentStatus: { UNASSIGNED: 1, ASSIGNED: 2, OUTPUT_UPLOADED: 2 },
      addressInvalid: 0,
      failed: 0,
      csUnassigned: 2,
      csAssigned: 3,
      byCsStatus: { UNASSIGNED: 2, DONE: 3 },
      bySalesChannelCode: { AMAZON: 4, ETSY: 1 },
      blockers: { SCALED_OUTPUT_MISSING: 2 },
    });
  });

  test('list maps OUTPUT_UPLOADED assignment status to output statuses', async () => {
    mockFind([]);

    await repository.list({ designAssignmentStatus: 'OUTPUT_UPLOADED' });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      status: { $in: ['QC_PENDING', 'QC_REJECTED', 'READY_TO_SEND_VENDOR', 'SENT_TO_VENDOR'] },
    }));
  });

  test('list limits the QC view to tasks pending QC', async () => {
    mockFind([]);

    await repository.list({ view: 'QC', qcStatus: 'REJECTED' });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      qcStatus: 'PENDING',
    }));
  });

  test('list limits the Scale view to tasks requiring design work', async () => {
    mockFind([]);

    await repository.list({ view: 'SCALE', status: 'QC_PENDING' });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      status: { $in: ['NEED_SCALE', 'QC_REJECTED'] },
    }));
  });

  test('list can hide tasks without a PSD template input', async () => {
    mockFind([]);

    await repository.list({ psdReadyOnly: true });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      fileChecks: {
        $elemMatch: {
          sourceType: 'PSD_TEMPLATE',
          inputAssetId: { $exists: true, $ne: null },
        },
      },
    }));
  });

  test('list filters ready-for-scale tasks to a valid address, matched vendor, PSD, and no blockers', async () => {
    mockFind([]);

    await repository.list({ readyForScale: true });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      vendorProductSnapshot: { $ne: null },
      vendorCostCenterSnapshot: { $ne: null },
      'orderSnapshot.addressValidationStatus': { $in: ['VALID', 'OVERRIDDEN'] },
      $and: expect.arrayContaining([
        { $or: [{ blockers: { $size: 0 } }, { blockers: { $exists: false } }] },
        { fileChecks: { $elemMatch: { sourceType: 'PSD_TEMPLATE', inputAssetId: { $ne: null } } } },
      ]),
    }));
  });

  test('list filters by date ranges, scale/qc users, and custom sort', async () => {
    const chain = mockFind([]);
    const createdFrom = new Date('2026-07-01T00:00:00.000Z');
    const createdTo = new Date('2026-07-02T00:00:00.000Z');
    const assignedFrom = new Date('2026-07-03T00:00:00.000Z');
    const readyTo = new Date('2026-07-04T00:00:00.000Z');

    await repository.list({
      dateFrom: createdFrom,
      dateTo: createdTo,
      assignedAtFrom: assignedFrom,
      readyAtTo: readyTo,
      assignedDesignUserId: '660000000000000000000903',
      qcBy: '660000000000000000000904',
      csAssigneeId: '660000000000000000000905',
      csStatus: 'IN_PROGRESS',
      sort: '-readyAt,assignedAt',
    });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      createdAt: { $gte: createdFrom, $lte: createdTo },
      assignedAt: { $gte: assignedFrom },
      readyAt: { $lte: readyTo },
      assignedDesignUserId: '660000000000000000000903',
      qcBy: '660000000000000000000904',
      csAssigneeId: '660000000000000000000905',
      csStatus: 'IN_PROGRESS',
    }));
    expect(chain.sort).toHaveBeenCalledWith({ readyAt: -1, assignedAt: 1, _id: 1 });
  });

  test('listPsdBlockedByListingId returns compact PSD-blocked tasks for listing', async () => {
    const chain = mockFind([{ _id: 'task-1' }]);

    const result = await repository.listPsdBlockedByListingId('660000000000000000000501');

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      blockers: 'PSD_MISSING',
      $or: expect.arrayContaining([
        { 'listingSnapshot.id': '660000000000000000000501' },
        { 'listingSnapshot._id': '660000000000000000000501' },
      ]),
    }));
    expect(chain.select).toHaveBeenCalledWith('_id orderItemId shopId blockers orderItemSnapshot');
    expect(result).toEqual([{ _id: 'task-1' }]);
  });

  test('lists only QC-passed tasks for score recovery', async () => {
    const chain = mockFind([{ _id: 'task-1' }]);

    await expect(repository.listQcPassedForWorkScore(25)).resolves.toEqual([{ _id: 'task-1' }]);

    expect(ProductionTask.find).toHaveBeenCalledWith({ qcStatus: 'PASSED' });
    expect(chain.limit).toHaveBeenCalledWith(25);
  });
});
