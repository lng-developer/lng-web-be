jest.mock('../../src/modules/shop/public', () => ({
  assertShopIsActive: jest.fn(),
}));

jest.mock('../../src/modules/hr/public', () => ({
  listEmployeeProfilesByEmployeeCodes: jest.fn(),
}));

jest.mock('../../src/modules/order/repositories/order.repository', () => ({
  create: jest.fn(),
  findByExternalIdentity: jest.fn(),
  updateFromExternalImport: jest.fn(),
  updateAssignedStaffIds: jest.fn(),
}));

jest.mock('../../src/modules/order/repositories/orderItem.repository', () => ({
  create: jest.fn(),
  findByExternalIdentity: jest.fn(),
  updateFromExternalImport: jest.fn(),
}));

jest.mock('../../src/modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../src/modules/order/services/orderCostCenterStatus.service', () => ({
  updateCostCenterStatusForOrder: jest.fn(),
  updatePsdStatusForOrder: jest.fn(),
}));

jest.mock('../../src/modules/order/services/orderWorkbenchProjection.service', () => ({
  upsertOrderWorkbenchBase: jest.fn(),
}));

const shopPublic = require('../../src/modules/shop/public');
const hrPublic = require('../../src/modules/hr/public');
const orderRepository = require('../../src/modules/order/repositories/order.repository');
const orderItemRepository = require('../../src/modules/order/repositories/orderItem.repository');
const orderReadinessService = require('../../src/modules/order/services/orderCostCenterStatus.service');
const orderTimelineService = require('../../src/modules/order/services/orderTimeline.service');
const orderWorkbenchProjectionService = require('../../src/modules/order/services/orderWorkbenchProjection.service');
const orderImportService = require('../../src/modules/order/services/orderImport.service');

const twoItemDto = {
  shopId: 'shop-1',
  source: 'AMAZON_EXTENSION_REPORT',
  salesChannelCode: 'AMAZON',
  marketplaceCode: 'AMAZON_US',
  externalOrderId: '113-2',
  items: [
    { externalItemId: 'line-1', quantity: 1, sku: 'SKU-1' },
    { externalItemId: 'line-2', quantity: 1, sku: 'SKU-2' },
  ],
};

const oneItemDto = {
  ...twoItemDto,
  externalOrderId: '113-3',
  items: [twoItemDto.items[0]],
};

describe('orderImportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shopPublic.assertShopIsActive.mockResolvedValue(true);
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([]);
    orderRepository.updateAssignedStaffIds.mockResolvedValue({});
  });

  test('rechecks order readiness after importing order items', async () => {
    orderRepository.findByExternalIdentity.mockResolvedValue(null);
    orderRepository.create.mockResolvedValue({
      _id: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1',
    });
    orderItemRepository.findByExternalIdentity.mockResolvedValue(null);
    orderItemRepository.create.mockResolvedValue({
      _id: 'item-1',
      orderId: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1',
      externalItemId: 'item-ext-1',
      quantity: 1,
    });

    await orderImportService.importExternalOrder({
      shopId: 'shop-1',
      source: 'AMAZON_EXTENSION_REPORT',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1',
      items: [{
        externalItemId: 'item-ext-1',
        quantity: 1,
        sku: 'SKU-1',
      }],
    });

    expect(orderReadinessService.updateCostCenterStatusForOrder).toHaveBeenCalledWith('order-1');
    expect(orderReadinessService.updatePsdStatusForOrder).toHaveBeenCalledWith('order-1');
  });

  test('creates the workbench projection after imported items are persisted', async () => {
    orderRepository.findByExternalIdentity.mockResolvedValue(null);
    orderRepository.create.mockResolvedValue({ _id: 'order-1', shopId: 'shop-1' });
    orderItemRepository.findByExternalIdentity.mockResolvedValue(null);
    orderItemRepository.create.mockResolvedValue({ _id: 'item-1', orderId: 'order-1', sku: 'SKU-1' });

    await orderImportService.importExternalOrder(oneItemDto);

    expect(orderWorkbenchProjectionService.upsertOrderWorkbenchBase).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'order-1' }),
      [expect.objectContaining({ _id: 'item-1' })],
    );
  });

  test('assigns every distinct staff account resolved from item SKU prefixes', async () => {
    orderRepository.findByExternalIdentity.mockResolvedValue(null);
    orderRepository.create.mockResolvedValue({ _id: 'order-1', shopId: 'shop-1' });
    orderItemRepository.findByExternalIdentity.mockResolvedValue(null);
    orderItemRepository.create
      .mockResolvedValueOnce({ _id: 'item-1', orderId: 'order-1' })
      .mockResolvedValueOnce({ _id: 'item-2', orderId: 'order-1' })
      .mockResolvedValueOnce({ _id: 'item-3', orderId: 'order-1' });
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([
      { employeeCode: 'J2501', accountId: 'account-1' },
      { employeeCode: 'J2502', accountId: 'account-2' },
    ]);

    await orderImportService.importExternalOrder({
      ...twoItemDto,
      items: [
        { externalItemId: 'line-1', quantity: 1, sku: 'J2501-DM-2394-3' },
        { externalItemId: 'line-2', quantity: 1, sku: 'j2502-AB-1' },
        { externalItemId: 'line-3', quantity: 1, sku: 'J2501-OTHER' },
      ],
    });

    expect(hrPublic.listEmployeeProfilesByEmployeeCodes).toHaveBeenCalledWith(['J2501', 'J2502']);
    expect(orderRepository.updateAssignedStaffIds).toHaveBeenCalledWith(
      'order-1',
      ['account-1', 'account-2'],
    );
  });

  test('clears stale assignments when no SKU prefix resolves on re-import', async () => {
    const existingOrder = { _id: 'order-1', shopId: 'shop-1', assignedStaffIds: ['old-account'] };
    orderRepository.findByExternalIdentity.mockResolvedValue(existingOrder);
    orderRepository.updateFromExternalImport.mockResolvedValue(existingOrder);
    orderItemRepository.findByExternalIdentity.mockResolvedValue({ _id: 'item-1', orderId: 'order-1' });
    orderItemRepository.updateFromExternalImport.mockResolvedValue({ _id: 'item-1', orderId: 'order-1' });

    await orderImportService.importExternalOrder({
      ...oneItemDto,
      source: 'MANUAL_EXCEL',
      items: [{ externalItemId: 'line-1', quantity: 1, sku: null }],
    });

    expect(orderRepository.updateAssignedStaffIds).toHaveBeenCalledWith('order-1', []);
  });

  test('absolutely skips an existing order from an Amazon extension report', async () => {
    orderRepository.findByExternalIdentity.mockResolvedValue({ _id: 'order-1', shopId: 'shop-1' });

    const result = await orderImportService.importExternalOrder(oneItemDto);

    expect(result).toMatchObject({ orderId: 'order-1', created: false, updated: false, skipped: true, itemResults: [] });
    expect(orderRepository.updateFromExternalImport).not.toHaveBeenCalled();
    expect(orderItemRepository.findByExternalIdentity).not.toHaveBeenCalled();
    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
    expect(orderReadinessService.updateCostCenterStatusForOrder).not.toHaveBeenCalled();
    expect(orderReadinessService.updatePsdStatusForOrder).not.toHaveBeenCalled();
  });

  test('retries a partial item import without recalculating readiness after the failed attempt', async () => {
    const existingOrder = { _id: 'order-1', shopId: 'shop-1' };
    const existingFirstItem = {
      _id: 'item-1', orderId: 'order-1', externalItemId: 'line-1',
    };
    const createdFirstItem = { ...existingFirstItem };
    const createdSecondItem = {
      _id: 'item-2', orderId: 'order-1', externalItemId: 'line-2',
    };

    orderRepository.findByExternalIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingOrder);
    orderRepository.create.mockResolvedValue(existingOrder);
    orderRepository.updateFromExternalImport.mockResolvedValue(existingOrder);
    orderItemRepository.findByExternalIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingFirstItem)
      .mockResolvedValueOnce(null);
    orderItemRepository.create
      .mockResolvedValueOnce(createdFirstItem)
      .mockRejectedValueOnce(new Error('second item write failed'));

    await expect(orderImportService.importExternalOrder({ ...twoItemDto, source: 'MANUAL_EXCEL' })).rejects.toThrow('second item write failed');
    expect(orderReadinessService.updateCostCenterStatusForOrder).not.toHaveBeenCalled();
    expect(orderReadinessService.updatePsdStatusForOrder).not.toHaveBeenCalled();

    orderItemRepository.create.mockResolvedValueOnce(createdSecondItem);

    const result = await orderImportService.importExternalOrder({ ...twoItemDto, source: 'MANUAL_EXCEL' });

    expect(result.itemResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalItemId: 'line-1', updated: true }),
      expect.objectContaining({ externalItemId: 'line-2', created: true }),
    ]));
  });

  test('does not overwrite an item status on re-import after production', async () => {
    const existingOrder = { _id: 'order-1', shopId: 'shop-1' };
    const existingItem = {
      _id: 'item-1', orderId: 'order-1', externalItemId: 'line-1', status: 'SENT_TO_VENDOR',
    };

    orderRepository.findByExternalIdentity.mockResolvedValue(existingOrder);
    orderRepository.updateFromExternalImport.mockResolvedValue(existingOrder);
    orderItemRepository.findByExternalIdentity.mockResolvedValue(existingItem);
    orderItemRepository.updateFromExternalImport.mockResolvedValue(existingItem);

    await orderImportService.importExternalOrder({ ...oneItemDto, source: 'MANUAL_EXCEL' });

    const [, updatePayload] = orderItemRepository.updateFromExternalImport.mock.calls[0];
    expect(updatePayload).not.toHaveProperty('set.status');
    expect(orderItemRepository.create).not.toHaveBeenCalled();
  });

  test('rejects a global order identity already owned by another shop', async () => {
    orderRepository.findByExternalIdentity.mockResolvedValue({
      _id: 'order-1',
      shopId: 'shop-1',
    });

    await expect(orderImportService.importExternalOrder({
      ...oneItemDto,
      shopId: 'shop-2',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      details: {
        requestedShopId: 'shop-2',
        identity: {
          salesChannelCode: 'AMAZON',
          marketplaceCode: 'AMAZON_US',
          externalOrderId: '113-3',
        },
      },
    });

    expect(orderRepository.updateFromExternalImport).not.toHaveBeenCalled();
    expect(orderItemRepository.create).not.toHaveBeenCalled();
    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
    expect(orderReadinessService.updateCostCenterStatusForOrder).not.toHaveBeenCalled();
  });

  test('rejects a different shop after duplicate-key race recovery', async () => {
    orderRepository.findByExternalIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'order-1', shopId: 'shop-1' });
    orderRepository.create.mockRejectedValue(Object.assign(
      new Error('E11000 duplicate key'),
      { code: 11000 },
    ));

    await expect(orderImportService.importExternalOrder({
      ...oneItemDto,
      shopId: 'shop-2',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(orderRepository.updateFromExternalImport).not.toHaveBeenCalled();
    expect(orderItemRepository.create).not.toHaveBeenCalled();
    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
  });

  test('continues same-shop import after duplicate-key race recovery', async () => {
    const recoveredOrder = { _id: 'order-1', shopId: 'shop-1' };
    const createdItem = { _id: 'item-1', orderId: 'order-1', externalItemId: 'line-1' };

    orderRepository.findByExternalIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(recoveredOrder);
    orderRepository.create.mockRejectedValue(Object.assign(
      new Error('E11000 duplicate key'),
      { code: 11000 },
    ));
    orderRepository.updateFromExternalImport.mockResolvedValue(recoveredOrder);
    orderItemRepository.findByExternalIdentity.mockResolvedValue(null);
    orderItemRepository.create.mockResolvedValue(createdItem);

    const result = await orderImportService.importExternalOrder({ ...oneItemDto, source: 'MANUAL_EXCEL' });

    expect(result).toMatchObject({ created: false, updated: true });
    expect(orderRepository.updateFromExternalImport).toHaveBeenCalledWith('order-1', expect.any(Object));
    expect(orderItemRepository.create).toHaveBeenCalledTimes(1);
  });
});
