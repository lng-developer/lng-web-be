jest.mock('../../../modules/production/models/productionTask.model', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

const ProductionTask = require('../../../modules/production/models/productionTask.model');
const repository = require('../../../modules/production/repositories/productionTask.repository');

describe('productionTask.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockFind(items = []) {
    const chain = {
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
      blocker: 'SCALED_OUTPUT_MISSING',
      designAssignmentStatus: 'UNASSIGNED',
      assignedDesignUserId: null,
      shopId: '660000000000000000000201',
      search: 'J2605',
      page: 2,
      limit: 10,
    });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      blockers: 'SCALED_OUTPUT_MISSING',
      assignedDesignUserId: null,
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

  test('list maps OUTPUT_UPLOADED assignment status to output statuses', async () => {
    mockFind([]);

    await repository.list({ designAssignmentStatus: 'OUTPUT_UPLOADED' });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      status: { $in: ['QC_PENDING', 'QC_REJECTED', 'READY_TO_SEND_VENDOR', 'SENT_TO_VENDOR'] },
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
      sort: '-readyAt,assignedAt',
    });

    expect(ProductionTask.find).toHaveBeenCalledWith(expect.objectContaining({
      createdAt: { $gte: createdFrom, $lte: createdTo },
      assignedAt: { $gte: assignedFrom },
      readyAt: { $lte: readyTo },
      assignedDesignUserId: '660000000000000000000903',
      qcBy: '660000000000000000000904',
    }));
    expect(chain.sort).toHaveBeenCalledWith({ readyAt: -1, assignedAt: 1, _id: 1 });
  });
});
