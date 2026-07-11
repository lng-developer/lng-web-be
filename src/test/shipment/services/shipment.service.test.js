jest.mock('../../../modules/vendorSubmission/public', () => ({
  getById: jest.fn(),
}));

jest.mock('../../../modules/order/public', () => ({
  appendTimeline: jest.fn(),
  findItemById: jest.fn(),
  listItemsByOrder: jest.fn(),
  markOrderDelivered: jest.fn(),
  transitionItemStatus: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/shipment/repositories/shipment.repository', () => ({
  create: jest.fn(),
  findActiveByVendorSubmission: jest.fn(),
  findById: jest.fn(),
  findByOrderItem: jest.fn(),
  list: jest.fn(),
  listByOrderItemIds: jest.fn(),
  updateById: jest.fn(),
}));

const vendorSubmissionPublic = require('../../../modules/vendorSubmission/public');
const orderPublic = require('../../../modules/order/public');
const authPublic = require('../../../modules/auth/public');
const repository = require('../../../modules/shipment/repositories/shipment.repository');
const service = require('../../../modules/shipment/services/shipment.service');

describe('shipment.service', () => {
  const shipmentId = '660000000000000000130001';
  const vendorSubmissionId = '660000000000000000130002';
  const orderId = '660000000000000000130003';
  const orderItemId = '660000000000000000130004';
  const shopId = '660000000000000000130005';
  const actorId = '660000000000000000130006';

  const submittedSubmission = {
    id: vendorSubmissionId,
    orderId,
    orderItemId,
    shopId,
    status: 'SUBMITTED',
  };

  const item = {
    _id: orderItemId,
    orderId,
    shopId,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    status: 'SENT_TO_VENDOR',
  };

  const shipment = {
    _id: shipmentId,
    vendorSubmissionId,
    orderId,
    orderItemId,
    shopId,
    status: 'TRACKING_PENDING',
    carrier: null,
    trackingNumber: null,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    vendorSubmissionPublic.getById.mockResolvedValue(submittedSubmission);
    orderPublic.findItemById.mockResolvedValue(item);
    orderPublic.listItemsByOrder.mockResolvedValue([{ _id: orderItemId, status: 'SHIPPED' }]);
    orderPublic.markOrderDelivered.mockResolvedValue({});
    orderPublic.transitionItemStatus.mockResolvedValue({});
    orderPublic.appendTimeline.mockResolvedValue({});
    repository.findActiveByVendorSubmission.mockResolvedValue(null);
    repository.create.mockResolvedValue(shipment);
    repository.findById.mockResolvedValue(shipment);
    repository.listByOrderItemIds.mockResolvedValue([{ ...shipment, status: 'DELIVERED' }]);
    repository.updateById.mockImplementation(async (_id, patch) => ({ ...shipment, ...patch }));
  });

  test('creates tracking pending shipment from submitted vendor submission', async () => {
    const result = await service.createFromVendorSubmission(vendorSubmissionId, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      vendorSubmissionId,
      orderId,
      orderItemId,
      shopId,
      status: 'TRACKING_PENDING',
    }));
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'TRACKING_PENDING', {
      source: 'SHIPMENT',
    });
    expect(result).toMatchObject({ id: shipmentId, status: 'TRACKING_PENDING' });
  });

  test('create from non-submitted vendor submission returns conflict', async () => {
    vendorSubmissionPublic.getById.mockResolvedValueOnce({ ...submittedSubmission, status: 'READY' });

    await expect(service.createFromVendorSubmission(vendorSubmissionId, {
      permissions: ['SHIPMENTS:WRITE'],
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  test('repeated create returns existing active shipment', async () => {
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(shipment);

    const result = await service.createFromVendorSubmission(vendorSubmissionId, {
      permissions: ['SHIPMENTS:WRITE'],
    });

    expect(repository.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: shipmentId });
  });

  test('scoped user cannot access another shop shipment', async () => {
    authPublic.canAccessScope.mockReturnValueOnce(false);

    await expect(service.getShipment(shipmentId, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });

  test('tracking update marks shipment shipped and transitions order item', async () => {
    const result = await service.updateTracking(shipmentId, {
      carrier: 'USPS',
      trackingNumber: '940011189922385',
      trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=940011189922385',
      note: 'Vendor tracking',
    }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(shipmentId, expect.objectContaining({
      carrier: 'USPS',
      trackingNumber: '940011189922385',
      status: 'SHIPPED',
      shippedAt: expect.any(Date),
    }));
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'SHIPPED', {
      source: 'SHIPMENT',
    });
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'TRACKING_AVAILABLE',
      source: 'SHIPMENT',
    }));
    expect(result.status).toBe('SHIPPED');
  });

  test('tracking update requires carrier and tracking number', async () => {
    await expect(service.updateTracking(shipmentId, {
      carrier: '',
      trackingNumber: ' ',
    }, { permissions: ['SHIPMENTS:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  test('delivered status sets deliveredAt and marks parent order delivered', async () => {
    const result = await service.updateStatus(shipmentId, { status: 'DELIVERED' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(shipmentId, expect.objectContaining({
      status: 'DELIVERED',
      deliveredAt: expect.any(Date),
    }));
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalledWith(orderItemId, 'DELIVERED', expect.anything());
    expect(orderPublic.markOrderDelivered).toHaveBeenCalledWith(orderId, expect.any(Date), {
      source: 'SHIPMENT',
    });
    expect(result.status).toBe('DELIVERED');
  });

  test('delivered status marks parent order delivered when every item shipment is delivered', async () => {
    const otherOrderItemId = '660000000000000000130007';
    orderPublic.listItemsByOrder.mockResolvedValueOnce([
      { _id: orderItemId, status: 'SHIPPED' },
      { _id: otherOrderItemId, status: 'SHIPPED' },
    ]);
    repository.listByOrderItemIds.mockResolvedValueOnce([
      { ...shipment, orderItemId, status: 'DELIVERED' },
      { ...shipment, _id: '660000000000000000130008', orderItemId: otherOrderItemId, status: 'DELIVERED' },
    ]);

    await service.updateStatus(shipmentId, { status: 'DELIVERED' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(orderPublic.markOrderDelivered).toHaveBeenCalledWith(orderId, expect.any(Date), {
      source: 'SHIPMENT',
    });
  });

  test('delivered status waits for all order item shipments before marking parent order delivered', async () => {
    const otherOrderItemId = '660000000000000000130007';
    orderPublic.listItemsByOrder.mockResolvedValueOnce([
      { _id: orderItemId, status: 'SHIPPED' },
      { _id: otherOrderItemId, status: 'SHIPPED' },
    ]);
    repository.listByOrderItemIds.mockResolvedValueOnce([
      { ...shipment, orderItemId, status: 'DELIVERED' },
      { ...shipment, _id: '660000000000000000130008', orderItemId: otherOrderItemId, status: 'SHIPPED' },
    ]);

    await service.updateStatus(shipmentId, { status: 'DELIVERED' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(orderPublic.markOrderDelivered).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalledWith(orderItemId, 'DELIVERED', expect.anything());
  });
});
