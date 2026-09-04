jest.mock('../../../src/modules/order/models/orderWorkbenchProjection.model', () => ({
  findOneAndUpdate: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

const OrderWorkbenchProjection = require('../../../src/modules/order/models/orderWorkbenchProjection.model');
const repository = require('../../../src/modules/order/repositories/orderWorkbenchProjection.repository');

describe('orderWorkbenchProjection.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    OrderWorkbenchProjection.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ orderId: 'order-1' }) });
  });

  test('patches only the requested item subtree', async () => {
    await repository.setItemFields('order-1', 'item-1', { production: { qcStatus: 'APPROVED' } });

    expect(OrderWorkbenchProjection.findOneAndUpdate).toHaveBeenCalledWith(
      { orderId: 'order-1' },
      { $set: { 'items.$[item].production': { qcStatus: 'APPROVED' } } },
      expect.objectContaining({
        arrayFilters: [{ 'item.orderItemId': 'item-1' }],
        returnDocument: 'after',
      }),
    );
  });

  test('reads a paginated projection page with the workbench default ordering', async () => {
    OrderWorkbenchProjection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ orderId: 'order-1' }]),
    });
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(7);

    const result = await repository.findPage({ page: 2, limit: 3, tab: 'ALL' });

    expect(OrderWorkbenchProjection.find).toHaveBeenCalledWith({});
    expect(result).toEqual({ items: [{ orderId: 'order-1' }], total: 7, page: 2, limit: 3 });
  });

  test('applies workbench tab, search, and item filters without joins', async () => {
    OrderWorkbenchProjection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]),
    });
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(0);

    await repository.findPage({
      tab: 'NEEDS_MAPPING', search: 'nurse', employeeCode: 'J2501', vendorId: 'vendor-1',
    });

    expect(OrderWorkbenchProjection.find).toHaveBeenCalledWith(expect.objectContaining({
      'items.item.status': 'MAPPING_PENDING',
      'items.item.sku': { $regex: '^J2501-', $options: 'i' },
      $or: expect.arrayContaining([
        { externalOrderId: { $regex: 'nurse', $options: 'i' } },
        { 'items.item.title': { $regex: 'nurse', $options: 'i' } },
      ]),
    }));
  });

  test('uses source order timestamps for historical filters and sorting', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]),
    };
    OrderWorkbenchProjection.find.mockReturnValue(chain);
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(0);

    await repository.findPage({ createdAtFrom: '2026-09-01', sort: '-createdAt' });

    expect(OrderWorkbenchProjection.find).toHaveBeenCalledWith({ sourceCreatedAt: { $gte: '2026-09-01' } });
    expect(chain.sort).toHaveBeenCalledWith({ sourceCreatedAt: -1, _id: 1 });
  });

  test('matches the current PSD tab using the persisted current-readiness result', async () => {
    OrderWorkbenchProjection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]),
    });
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(0);

    await repository.findPage({ tab: 'NO_PSD' });

    expect(OrderWorkbenchProjection.find).toHaveBeenCalledWith({ hasCurrentPsd: false });
  });
});
