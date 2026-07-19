jest.mock('../../../modules/vendorSubmission/public', () => ({
  getById: jest.fn(),
  listSubmittedForTracking: jest.fn(),
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
  summarizeShippedByOrderItemIds: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../../../modules/shipment/services/vendorTrackingAdapterRegistry.service', () => ({
  getTrackingAdapter: jest.fn(),
}));

const vendorSubmissionPublic = require('../../../modules/vendorSubmission/public');
const orderPublic = require('../../../modules/order/public');
const authPublic = require('../../../modules/auth/public');
const repository = require('../../../modules/shipment/repositories/shipment.repository');
const { getTrackingAdapter } = require('../../../modules/shipment/services/vendorTrackingAdapterRegistry.service');
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
    provider: 'MERCHIZE',
    externalOrderId: '112-1234567-1234567',
    vendorExternalOrderId: 'MZ-ORDER-1',
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
    repository.findByOrderItem.mockResolvedValue(null);
    repository.create.mockResolvedValue(shipment);
    repository.findById.mockResolvedValue(shipment);
    repository.listByOrderItemIds.mockResolvedValue([{ ...shipment, status: 'DELIVERED' }]);
    repository.summarizeShippedByOrderItemIds.mockResolvedValue({ [orderItemId]: 1 });
    repository.updateById.mockImplementation(async (_id, patch) => ({ ...shipment, ...patch }));
    getTrackingAdapter.mockReturnValue({
      fetchTrackingByExternalOrderId: jest.fn().mockResolvedValue({
        provider: 'MERCHIZE',
        externalOrderId: '112-7237034-7096265',
        carrier: 'USPS',
        trackingNumber: '9214490411375403131206',
        trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=9214490411375403131206',
        vendorStatus: 'PRE_TRANSIT',
        rawStatus: 'fulfilled',
      }),
    });
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
      provider: 'MERCHIZE',
      externalOrderId: '112-1234567-1234567',
      vendorExternalOrderId: 'MZ-ORDER-1',
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

  test('listShipments applies scoped shop ids before querying repository', async () => {
    repository.list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });

    await service.listShipments({ page: 1, limit: 20 }, {
      permissions: [],
      scopes: [{
        scopeType: 'shop',
        scopeId: shopId,
        permissions: ['SHIPMENTS:READ'],
      }],
    });

    expect(repository.list).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      shopIds: [shopId],
    });
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
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });

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
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
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

  test('delivered status ignores cancelled sibling items when marking parent order delivered', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
    const cancelledItemId = '660000000000000000130007';
    orderPublic.listItemsByOrder.mockResolvedValueOnce([
      { _id: orderItemId, status: 'SHIPPED' },
      { _id: cancelledItemId, status: 'CANCELLED' },
    ]);
    repository.listByOrderItemIds.mockResolvedValueOnce([
      { ...shipment, orderItemId, status: 'DELIVERED' },
    ]);

    await service.updateStatus(shipmentId, { status: 'DELIVERED' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.listByOrderItemIds).toHaveBeenCalledWith([orderItemId]);
    expect(orderPublic.markOrderDelivered).toHaveBeenCalledWith(orderId, expect.any(Date), {
      source: 'SHIPMENT',
    });
  });

  test('delivered status waits for all order item shipments before marking parent order delivered', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
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

  test('rejects direct delivery from tracking pending', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'TRACKING_PENDING' });

    await expect(service.updateStatus(shipmentId, { status: 'DELIVERED' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
  });

  test('replaying the same tracking on a delivered shipment is a no-op', async () => {
    const deliveredShipment = {
      ...shipment,
      status: 'DELIVERED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    };
    repository.findById.mockResolvedValueOnce(deliveredShipment);

    const result = await service.updateTracking(shipmentId, {
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(result).toMatchObject({ id: shipmentId, status: 'DELIVERED' });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('rejects changed tracking on a delivered shipment', async () => {
    repository.findById.mockResolvedValueOnce({
      ...shipment,
      status: 'DELIVERED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    });

    await expect(service.updateTracking(shipmentId, {
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
    }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('replaying delivered status is a no-op', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'DELIVERED' });

    const result = await service.updateStatus(shipmentId, { status: 'DELIVERED' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(result).toMatchObject({ id: shipmentId, status: 'DELIVERED' });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('summarizes shipped shipments by order item ids in one repository call', async () => {
    const result = await service.summarizeShippedByOrderItemIds([
      orderItemId,
      orderItemId,
    ]);

    expect(repository.summarizeShippedByOrderItemIds).toHaveBeenCalledWith([orderItemId]);
    expect(result).toEqual({ [orderItemId]: 1 });
  });

  test('vendor tracking recheck without submission returns normalized tracking without mutation', async () => {
    const result = await service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-07-17T23:59:59.999Z',
    }, { permissions: ['SHIPMENTS:WRITE'] });

    expect(getTrackingAdapter).toHaveBeenCalledWith('MERCHIZE');
    expect(getTrackingAdapter.mock.results[0].value.fetchTrackingByExternalOrderId).toHaveBeenCalledWith(
      '112-7237034-7096265',
      {
        dateFrom: new Date('2026-06-01T00:00:00.000Z'),
        dateTo: new Date('2026-07-17T23:59:59.999Z'),
      },
    );
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      applied: false,
      tracking: {
        provider: 'MERCHIZE',
        carrier: 'USPS',
        trackingNumber: '9214490411375403131206',
      },
    });
  });

  test('vendor tracking recheck with submitted submission creates shipment and updates tracking', async () => {
    const result = await service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      vendorSubmissionId,
      status: 'TRACKING_PENDING',
    }));
    expect(repository.updateById).toHaveBeenCalledWith(shipmentId, expect.objectContaining({
      carrier: 'USPS',
      trackingNumber: '9214490411375403131206',
      status: 'SHIPPED',
    }));
    expect(result).toMatchObject({
      applied: true,
      shipment: {
        id: shipmentId,
        status: 'SHIPPED',
        trackingNumber: '9214490411375403131206',
      },
    });
  });

  test('keeps a submitted shipment tracking pending when the vendor has no tracking yet', async () => {
    getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockResolvedValue({
        provider: 'MERCHIZE',
        externalOrderId: '112-7237034-7096265',
        carrier: null,
        trackingNumber: null,
        trackingUrl: null,
        vendorStatus: 'PROCESSING',
        rawStatus: 'processing',
      }),
    });

    const result = await service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      vendorSubmissionId,
      status: 'TRACKING_PENDING',
    }));
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'TRACKING_PENDING', {
      source: 'SHIPMENT',
    });
    expect(result).toMatchObject({
      applied: false,
      reason: 'TRACKING_NOT_FOUND',
      shipment: { id: shipmentId, status: 'TRACKING_PENDING' },
    });
  });

  test('submitted vendor tracking batch applies eligible submissions and skips delivered shipments', async () => {
    const deliveredOrderItemId = '660000000000000000130010';
    vendorSubmissionPublic.listSubmittedForTracking.mockResolvedValue([
      {
        id: vendorSubmissionId,
        provider: 'PRINTWAY',
        vendorExternalOrderId: '4095267035',
        orderItemId,
        shopId,
      },
      {
        id: '660000000000000000130009',
        provider: 'LENFUL',
        vendorExternalOrderId: '111-9039002-8646662',
        orderItemId: deliveredOrderItemId,
        shopId,
      },
      {
        id: '660000000000000000130011',
        provider: null,
        vendorExternalOrderId: null,
        orderItemId: '660000000000000000130012',
        shopId,
      },
    ]);
    repository.findByOrderItem.mockImplementation(async (id) => (
      id === deliveredOrderItemId
        ? { _id: '660000000000000000130013', status: 'DELIVERED', orderItemId: id }
        : null
    ));

    const result = await service.recheckSubmittedVendorTracking({ limit: 3 }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(vendorSubmissionPublic.listSubmittedForTracking).toHaveBeenCalledWith({
      limit: 3,
    }, expect.objectContaining({
      permissions: ['SHIPMENTS:WRITE'],
      system: true,
      source: 'SHIPMENT_TRACKING_RECHECK_BATCH',
    }));
    expect(result).toMatchObject({
      checked: 3,
      applied: 1,
      skipped: 2,
      failed: 0,
    });
    expect(result.items.map((row) => row.status)).toEqual(['APPLIED', 'SKIPPED', 'SKIPPED']);
  });

  test('submitted vendor tracking batch records failures without failing whole batch', async () => {
    vendorSubmissionPublic.listSubmittedForTracking.mockResolvedValue([
      {
        id: vendorSubmissionId,
        provider: 'PRINTWAY',
        vendorExternalOrderId: '4095267035',
        orderItemId,
        shopId,
      },
    ]);
    getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockRejectedValue(Object.assign(new Error('vendor down'), {
        vendorHttpStatus: 502,
      })),
    });

    const result = await service.recheckSubmittedVendorTracking({}, {
      permissions: ['SHIPMENTS:WRITE'],
    });

    expect(result).toMatchObject({
      checked: 1,
      applied: 0,
      skipped: 0,
      failed: 1,
    });
    expect(result.items[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'CONFLICT_ERROR',
    });
  });

  test('submitted vendor tracking batch scopes submitted submissions by shop permissions', async () => {
    vendorSubmissionPublic.listSubmittedForTracking.mockResolvedValue([]);

    await service.recheckSubmittedVendorTracking({}, {
      permissions: [],
      scopes: [{
        scopeType: 'shop',
        scopeId: shopId,
        permissions: ['SHIPMENTS:WRITE'],
      }],
    });

    expect(vendorSubmissionPublic.listSubmittedForTracking).toHaveBeenCalledWith({
      limit: 50,
      shopIds: [shopId],
    }, expect.objectContaining({
      system: true,
      source: 'SHIPMENT_TRACKING_RECHECK_BATCH',
    }));
  });

  test('vendor tracking recheck rejects unsupported provider', async () => {
    getTrackingAdapter.mockReturnValueOnce({});

    await expect(service.recheckVendorTracking({
      provider: 'ONOSPOD',
      externalOrderId: '112-7237034-7096265',
    }, { permissions: ['SHIPMENTS:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });
});
