jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
  listAllByOrder: jest.fn(),
  updateAsin: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../../src/modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateDeliveredAt: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderWorkbenchProjection.service', () => ({
  updateOrderWorkbenchItem: jest.fn(),
  updateOrderWorkbenchOrder: jest.fn(),
}));

const orderItemRepository = require('../../../src/modules/order/repositories/orderItem.repository');
const orderRepository = require('../../../src/modules/order/repositories/order.repository');
const orderTimelineService = require('../../../src/modules/order/services/orderTimeline.service');
const projectionService = require('../../../src/modules/order/services/orderWorkbenchProjection.service');
const service = require('../../../src/modules/order/services/orderItemStatusTransition.service');
const orderPublic = require('../../../src/modules/order/public');

describe('orderItemStatusTransition.service', () => {
  const orderItemId = '660000000000000000000401';
  const orderId = '660000000000000000000301';

  beforeEach(() => {
    jest.clearAllMocks();
    orderItemRepository.listAllByOrder.mockResolvedValue([]);
    orderRepository.findById.mockResolvedValue({
      _id: orderId,
      shopId: '660000000000000000000201',
      status: 'IMPORTED',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
    });
    orderRepository.updateDeliveredAt.mockResolvedValue({});
    orderRepository.updateStatus.mockResolvedValue({
      _id: orderId,
      shopId: '660000000000000000000201',
      status: 'PROCESSING',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
    });
    orderTimelineService.appendTimeline.mockResolvedValue({});
  });

  test('allows valid transitions', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      status: 'CUSTOMIZATION_PENDING',
    });
    orderItemRepository.updateStatus.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'CUSTOMIZATION_PARSED',
    });

    const result = await service.transitionItemStatus(orderItemId, 'CUSTOMIZATION_PARSED', {
      source: 'TEST',
    });

    expect(orderItemRepository.updateStatus).toHaveBeenCalledWith(orderItemId, 'CUSTOMIZATION_PARSED');
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId: '660000000000000000000201',
      eventType: 'ORDER_ITEM_STATUS_CHANGED',
      fromStatus: 'CUSTOMIZATION_PENDING',
      toStatus: 'CUSTOMIZATION_PARSED',
      source: 'SYSTEM',
    }));
    expect(projectionService.updateOrderWorkbenchItem).toHaveBeenCalledWith(
      orderId,
      orderItemId,
      { 'item.status': 'CUSTOMIZATION_PARSED' },
      { source: 'ORDER_ITEM_STATUS' },
    );
    expect(result.status).toBe('CUSTOMIZATION_PARSED');
  });

  test('syncs an imported ASIN to the order item projection', async () => {
    orderItemRepository.updateAsin.mockResolvedValue({
      _id: orderItemId,
      orderId,
      asin: 'B0TESTASIN',
    });

    await orderPublic.updateItemAsin(orderItemId, 'B0TESTASIN');

    expect(orderItemRepository.updateAsin).toHaveBeenCalledWith(orderItemId, 'B0TESTASIN');
    expect(projectionService.updateOrderWorkbenchItem).toHaveBeenCalledWith(
      orderId,
      orderItemId,
      { 'item.asin': 'B0TESTASIN' },
      { source: 'ORDER_ITEM_ASIN' },
    );
  });

  test('allows stale fulfillment-ready item to return to mapping pending', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId: '660000000000000000000201',
      status: 'FULFILLMENT_READY',
    });
    orderItemRepository.updateStatus.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'MAPPING_PENDING',
    });

    const result = await service.transitionItemStatus(orderItemId, 'MAPPING_PENDING', {
      source: 'EXTERNAL_ORDER_IMPORT',
    });

    expect(orderItemRepository.updateStatus).toHaveBeenCalledWith(orderItemId, 'MAPPING_PENDING');
    expect(result.status).toBe('MAPPING_PENDING');
  });

  test('allows production to move parsed customization item into need production', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId: '660000000000000000000201',
      salesChannelCode: 'ETSY',
      marketplaceCode: 'ETSY_US',
      status: 'CUSTOMIZATION_PARSED',
    });
    orderItemRepository.updateStatus.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'NEED_PRODUCTION',
    });

    const result = await service.transitionItemStatus(orderItemId, 'NEED_PRODUCTION', {
      source: 'PRODUCTION',
    });

    expect(orderItemRepository.updateStatus).toHaveBeenCalledWith(orderItemId, 'NEED_PRODUCTION');
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: 'CUSTOMIZATION_PARSED',
      toStatus: 'NEED_PRODUCTION',
      source: 'PRODUCTION',
    }));
    expect(result.status).toBe('NEED_PRODUCTION');
  });

  test('appends parent order status timeline when derived status changes', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      status: 'TRACKING_PENDING',
    });
    orderItemRepository.updateStatus.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId: '660000000000000000000201',
      status: 'SHIPPED',
    });
    orderItemRepository.listAllByOrder.mockResolvedValue([{ _id: orderItemId, status: 'SHIPPED' }]);
    orderRepository.findById.mockResolvedValue({
      _id: orderId,
      shopId: '660000000000000000000201',
      status: 'PROCESSING',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
    });
    orderRepository.updateStatus.mockResolvedValue({
      _id: orderId,
      shopId: '660000000000000000000201',
      status: 'SHIPPED',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
    });

    await service.transitionItemStatus(orderItemId, 'SHIPPED', { source: 'SHIPMENT' });

    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      eventType: 'ORDER_STATUS_CHANGED',
      fromStatus: 'PROCESSING',
      toStatus: 'SHIPPED',
      source: 'SHIPMENT',
    }));
  });

  test('markOrderDelivered appends delivered timeline', async () => {
    orderRepository.updateDeliveredAt.mockResolvedValue({
      _id: orderId,
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      deliveredAt: new Date(),
    });

    await service.markOrderDelivered(orderId, new Date('2026-07-01T00:00:00.000Z'), { source: 'SHIPMENT' });

    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      shopId: '660000000000000000000201',
      eventType: 'ORDER_DELIVERED',
      source: 'SHIPMENT',
    }));
  });

  test('syncs parent order to shipped when all items are shipped', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'TRACKING_PENDING',
    });
    orderItemRepository.updateStatus.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'SHIPPED',
    });
    orderItemRepository.listAllByOrder.mockResolvedValue([
      { _id: orderItemId, status: 'SHIPPED' },
      { _id: '660000000000000000000402', status: 'SHIPPED' },
    ]);

    await service.transitionItemStatus(orderItemId, 'SHIPPED');

    expect(orderRepository.updateStatus).toHaveBeenCalledWith(orderId, 'SHIPPED');
  });

  test('syncs parent order to partially shipped when only some items are shipped', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'TRACKING_PENDING',
    });
    orderItemRepository.updateStatus.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'SHIPPED',
    });
    orderItemRepository.listAllByOrder.mockResolvedValue([
      { _id: orderItemId, status: 'SHIPPED' },
      { _id: '660000000000000000000402', status: 'READY_TO_SEND_VENDOR' },
    ]);

    await service.transitionItemStatus(orderItemId, 'SHIPPED');

    expect(orderRepository.updateStatus).toHaveBeenCalledWith(orderId, 'PARTIALLY_SHIPPED');
  });

  test('syncs parent order to processing while fulfillment is active but not shipped', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'SENT_TO_VENDOR',
    });
    orderItemRepository.updateStatus.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'TRACKING_PENDING',
    });
    orderItemRepository.listAllByOrder.mockResolvedValue([
      { _id: orderItemId, status: 'TRACKING_PENDING' },
      { _id: '660000000000000000000402', status: 'FULFILLMENT_READY' },
    ]);

    await service.transitionItemStatus(orderItemId, 'TRACKING_PENDING');

    expect(orderRepository.updateStatus).toHaveBeenCalledWith(orderId, 'PROCESSING');
  });

  test('marks payment refunded when the financial confirmation refunds every item', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'SHIPPED',
    });
    orderItemRepository.updateStatus.mockResolvedValue({
      _id: orderItemId,
      orderId,
      status: 'REFUNDED',
    });
    orderItemRepository.listAllByOrder.mockResolvedValue([
      { _id: orderItemId, status: 'REFUNDED' },
    ]);

    await service.transitionItemStatus(orderItemId, 'REFUNDED', {
      allowFinancialRefundConfirmation: true,
    });

    expect(orderRepository.updateStatus).toHaveBeenCalledWith(orderId, 'REFUNDED', {
      paymentStatus: 'REFUNDED',
    });
  });

  test('derives processing while customization is active', () => {
    expect(service.deriveOrderStatusFromItems([
      { status: 'CUSTOMIZATION_PENDING' },
    ])).toBe('PROCESSING');
    expect(service.deriveOrderStatusFromItems([
      { status: 'CUSTOMIZATION_PARSED' },
    ])).toBe('PROCESSING');
  });

  test('derives partially shipped for shipped mixed with cancelled or refunded', () => {
    expect(service.deriveOrderStatusFromItems([
      { status: 'SHIPPED' },
      { status: 'CANCELLED' },
    ])).toBe('PARTIALLY_SHIPPED');
    expect(service.deriveOrderStatusFromItems([
      { status: 'SHIPPED' },
      { status: 'REFUNDED' },
    ])).toBe('PARTIALLY_SHIPPED');
  });

  test('derives terminal only when all items share that terminal status', () => {
    expect(service.deriveOrderStatusFromItems([
      { status: 'CANCELLED' },
      { status: 'CANCELLED' },
    ])).toBe('CANCELLED');
    expect(service.deriveOrderStatusFromItems([
      { status: 'CANCELLED' },
      { status: 'NEW' },
    ])).toBe('IMPORTED');
  });

  test('rejects invalid jumps', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      status: 'CUSTOMIZATION_PENDING',
    });

    await expect(service.transitionItemStatus(orderItemId, 'READY_TO_SEND_VENDOR', {
      source: 'TEST',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      details: {
        fromStatus: 'CUSTOMIZATION_PENDING',
        targetStatus: 'READY_TO_SEND_VENDOR',
      },
    });
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });

  test('rejects transitions from terminal statuses', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      status: 'SHIPPED',
    });

    await expect(service.transitionItemStatus(orderItemId, 'TRACKING_PENDING')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });

  test('permits a finance-confirmed refund without invoking fulfillment operations', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId: '660000000000000000000201',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      status: 'SHIPPED',
    });
    orderItemRepository.updateStatus.mockResolvedValue({ _id: orderItemId, orderId, status: 'REFUNDED' });

    await service.transitionItemStatus(orderItemId, 'REFUNDED', {
      source: 'FINANCE_REFUND_CONFIRMATION',
      allowFinancialRefundConfirmation: true,
    });

    expect(orderItemRepository.updateStatus).toHaveBeenCalledWith(orderItemId, 'REFUNDED');
  });

  test('rejects delivered as an order item status', async () => {
    await expect(service.transitionItemStatus(orderItemId, 'DELIVERED')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details: { status: 'DELIVERED' },
    });
    expect(orderItemRepository.findById).not.toHaveBeenCalled();
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });

  test('same status transition is idempotent', async () => {
    const item = {
      _id: orderItemId,
      status: 'NEED_PRODUCTION',
    };
    orderItemRepository.findById.mockResolvedValue(item);

    const result = await service.transitionItemStatus(orderItemId, 'NEED_PRODUCTION');

    expect(result).toBe(item);
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });

  test('public updateItemStatus compatibility alias enforces transition rules', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      status: 'CUSTOMIZATION_PENDING',
    });

    await expect(orderPublic.updateItemStatus(orderItemId, 'READY_TO_SEND_VENDOR')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });
});
