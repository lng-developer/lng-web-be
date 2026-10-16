jest.mock('../../../src/modules/vendorSubmission/public', () => ({
  getById: jest.fn(),
  listSubmittedForTracking: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/public', () => ({
  getVendorIntegrationAssignment: jest.fn(),
  getVendorIntegrationCredential: jest.fn(),
}));

jest.mock('../../../src/modules/order/public', () => ({
  personalSellerItemIds: jest.fn(),
  appendTimeline: jest.fn(),
  appendTimelineOnce: jest.fn(),
  findById: jest.fn(),
  findItemById: jest.fn(),
  listItemsByOrder: jest.fn(),
  markOrderDelivered: jest.fn(),
  transitionItemStatus: jest.fn(),
  updateOrderWorkbenchItem: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../src/modules/notification/public', () => ({
  notify: jest.fn(),
}));

jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn(),
}));

jest.mock('../../../src/shared/utils/logger', () => ({
  warn: jest.fn(),
}));

jest.mock('../../../src/modules/shipment/repositories/shipment.repository', () => ({
  create: jest.fn(),
  findActiveByVendorSubmission: jest.fn(),
  findById: jest.fn(),
  findByOrderItem: jest.fn(),
  list: jest.fn(),
  listByOrderItemIds: jest.fn(),
  summarizeShippedByOrderItemIds: jest.fn(),
  updateById: jest.fn(),
  updateStatusIfCurrent: jest.fn(),
  updateTrackingIfNotDelivered: jest.fn(),
  touchLastCheckedAtByVendorSubmission: jest.fn(),
}));

jest.mock('../../../src/modules/shipment/services/vendorTrackingAdapterRegistry.service', () => ({
  getTrackingAdapter: jest.fn(),
}));

const vendorSubmissionPublic = require('../../../src/modules/vendorSubmission/public');
const vendorPublic = require('../../../src/modules/vendor/public');
const orderPublic = require('../../../src/modules/order/public');
const authPublic = require('../../../src/modules/auth/public');
const notificationPublic = require('../../../src/modules/notification/public');
const auditPublic = require('../../../src/modules/audit/public');
const logger = require('../../../src/shared/utils/logger');
const repository = require('../../../src/modules/shipment/repositories/shipment.repository');
const { getTrackingAdapter } = require('../../../src/modules/shipment/services/vendorTrackingAdapterRegistry.service');
const service = require('../../../src/modules/shipment/services/shipment.service');

describe('shipment.service', () => {
  test('Seller reads own shipment but not another item in the same shop', async () => {
    orderPublic.personalSellerItemIds.mockResolvedValue(['660000000000000000130004']);
    repository.findById.mockResolvedValue({ _id: '660000000000000000130001', orderItemId: '660000000000000000130004', shopId: 'same-shop' });
    const auth = { accountId: 'seller-a', permissions: ['SHIPMENTS:READ'] };
    expect(await service.getShipment('660000000000000000130001', auth)).toMatchObject({ orderItemId: '660000000000000000130004' });
    repository.findById.mockResolvedValue({ _id: '660000000000000000130001', orderItemId: 'other-item', shopId: 'same-shop' });
    await expect(service.getShipment('660000000000000000130001', auth)).rejects.toMatchObject({ statusCode: 403 });
    orderPublic.personalSellerItemIds.mockReset();
  });
  const shipmentId = '660000000000000000130001';
  const vendorSubmissionId = '660000000000000000130002';
  const orderId = '660000000000000000130003';
  const orderItemId = '660000000000000000130004';
  const shopId = '660000000000000000130005';
  const actorId = '660000000000000000130006';
  const assignedStaffId = '660000000000000000130007';
  const vendorId = '660000000000000000130009';

  const submittedSubmission = {
    id: vendorSubmissionId,
    orderId,
    orderItemId,
    shopId,
    status: 'SUBMITTED',
    provider: 'MERCHIZE',
    externalOrderId: '112-1234567-1234567',
    vendorExternalOrderId: '112-7237034-7096265',
    payloadSnapshot: {
      vendorProduct: { vendor: { id: vendorId, providerKey: 'MERCHIZE' } },
    },
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
    vendorPublic.getVendorIntegrationCredential.mockResolvedValue({
      baseUrl: 'https://vendor.test', accessToken: 'vendor-token',
    });
    vendorPublic.getVendorIntegrationAssignment.mockResolvedValue({ providerKey: 'MERCHIZE', status: 'CONNECTED' });
    orderPublic.findById.mockResolvedValue({ _id: orderId, assignedStaffIds: [assignedStaffId] });
    orderPublic.findItemById.mockResolvedValue(item);
    orderPublic.listItemsByOrder.mockResolvedValue([{ _id: orderItemId, status: 'SHIPPED' }]);
    orderPublic.markOrderDelivered.mockResolvedValue({});
    orderPublic.transitionItemStatus.mockResolvedValue({});
    orderPublic.appendTimeline.mockResolvedValue({});
    orderPublic.appendTimelineOnce.mockResolvedValue({});
    repository.findActiveByVendorSubmission.mockResolvedValue(null);
    repository.findByOrderItem.mockResolvedValue(null);
    repository.create.mockResolvedValue(shipment);
    repository.findById.mockResolvedValue(shipment);
    repository.listByOrderItemIds.mockResolvedValue([{ ...shipment, status: 'DELIVERED' }]);
    repository.summarizeShippedByOrderItemIds.mockResolvedValue({ [orderItemId]: 1 });
    repository.updateById.mockImplementation(async (_id, patch) => ({ ...shipment, ...patch }));
    repository.updateStatusIfCurrent.mockImplementation(async (_id, _currentStatus, patch) => ({ ...shipment, ...patch }));
    repository.updateTrackingIfNotDelivered.mockImplementation(async (_id, patch) => ({ ...shipment, ...patch }));
    repository.touchLastCheckedAtByVendorSubmission.mockResolvedValue(shipment);
    notificationPublic.notify.mockResolvedValue({ delivered: true, id: 'notification-1' });
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
      vendorExternalOrderId: '112-7237034-7096265',
      status: 'TRACKING_PENDING',
    }));
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'TRACKING_PENDING', {
      source: 'SHIPMENT',
    });
    expect(result).toMatchObject({ id: shipmentId, status: 'TRACKING_PENDING' });
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SHIPMENT_CREATED',
      actorType: 'ACCOUNT',
      actorAccountId: actorId,
      metadata: expect.objectContaining({ vendorSubmissionId, provider: null }),
    }), {});
  });

  test('records shipment tracking updates as account-scoped events without tracking data', async () => {
    await service.updateTracking(shipmentId, {
      carrier: 'USPS',
      trackingNumber: '940011189922385',
    }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: actorId,
      action: 'SHIPMENT_TRACKING_UPDATED',
      entityType: 'SHIPMENT',
      entityId: shipmentId,
      scopeType: 'SHOP',
      scopeId: shopId,
      source: 'HTTP',
    }), {});
    expect(JSON.stringify(auditPublic.record.mock.calls[0][0])).not.toContain('940011189922385');
  });

  test('create from non-submitted vendor submission returns conflict', async () => {
    vendorSubmissionPublic.getById.mockResolvedValueOnce({ ...submittedSubmission, status: 'READY' });

    await expect(service.createFromVendorSubmission(vendorSubmissionId, {
      permissions: ['SHIPMENTS:WRITE'],
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  test('recheck uses only the persisted vendor identity and scoped credential', async () => {
    const adapter = getTrackingAdapter();

    await service.recheckVendorTracking({ vendorSubmissionId }, {
      permissions: ['SHIPMENTS:WRITE'],
    });

    expect(vendorPublic.getVendorIntegrationCredential)
      .toHaveBeenCalledWith(vendorId, 'MERCHIZE');
    expect(adapter.fetchTrackingByExternalOrderId).toHaveBeenCalledWith(
      '112-7237034-7096265',
      expect.objectContaining({
        credential: { baseUrl: 'https://vendor.test', accessToken: 'vendor-token' },
      }),
    );
  });

  test('recheck rejects caller identity mismatch before vendor request', async () => {
    await expect(service.recheckVendorTracking({
      vendorSubmissionId,
      provider: 'PRINTWAY',
    }, { permissions: ['SHIPMENTS:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(getTrackingAdapter).not.toHaveBeenCalled();
  });

  test('repeated tracking-pending create repairs the order item transition', async () => {
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(shipment);

    const result = await service.createFromVendorSubmission(vendorSubmissionId, {
      permissions: ['SHIPMENTS:WRITE'],
    });

    expect(repository.create).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'TRACKING_PENDING', {
      source: 'SHIPMENT',
    });
    expect(result).toMatchObject({ id: shipmentId });
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('keeps a created shipment when its best-effort audit write fails', async () => {
    auditPublic.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.createFromVendorSubmission(vendorSubmissionId, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    })).resolves.toMatchObject({ id: shipmentId, status: 'TRACKING_PENDING' });

    expect(repository.create).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('shipment_audit_write_failed', expect.objectContaining({
      action: 'SHIPMENT_CREATED',
      entityId: shipmentId,
    }));
  });

  test('returns the duplicate shipment after a unique-index create race', async () => {
    repository.create.mockRejectedValueOnce({ code: 11000 });
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(null).mockResolvedValueOnce(shipment);

    await expect(service.createFromVendorSubmission(vendorSubmissionId, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    })).resolves.toMatchObject({ id: shipmentId });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'TRACKING_PENDING', {
      source: 'SHIPMENT',
    });
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

    expect(repository.updateTrackingIfNotDelivered).toHaveBeenCalledWith(shipmentId, expect.objectContaining({
      carrier: 'USPS',
      trackingNumber: '940011189922385',
      status: 'SHIPPED',
      shippedAt: expect.any(Date),
    }));
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'SHIPPED', {
      source: 'SHIPMENT',
    });
    expect(orderPublic.appendTimelineOnce).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'TRACKING_AVAILABLE',
      source: 'SHIPMENT',
      idempotencyKey: expect.stringMatching(new RegExp(`^SHIPMENT_TRACKING_AVAILABLE:${shipmentId}:`)),
      metadata: {
        carrier: 'USPS',
        trackingNumber: '940011189922385',
      },
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

  test('does not overwrite a delivered shipment when conditional tracking update loses a race', async () => {
    const deliveredShipment = {
      ...shipment,
      status: 'DELIVERED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    };
    repository.findById
      .mockResolvedValueOnce(shipment)
      .mockResolvedValueOnce(deliveredShipment);
    repository.updateTrackingIfNotDelivered.mockResolvedValueOnce(null);

    await expect(service.updateTracking(shipmentId, {
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
    }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.findById).toHaveBeenCalledTimes(2);
  });

  test('returns delivered tracking when conditional tracking update loses a race with the same tracking', async () => {
    const deliveredShipment = {
      ...shipment,
      status: 'DELIVERED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    };
    repository.findById
      .mockResolvedValueOnce(shipment)
      .mockResolvedValueOnce(deliveredShipment);
    repository.updateTrackingIfNotDelivered.mockResolvedValueOnce(null);

    await expect(service.updateTracking(shipmentId, {
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    })).resolves.toMatchObject({
      id: shipmentId,
      status: 'DELIVERED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'SHIPPED', {
      source: 'SHIPMENT',
    });
    expect(orderPublic.appendTimelineOnce).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'TRACKING_AVAILABLE',
      idempotencyKey: expect.stringMatching(new RegExp(`^SHIPMENT_TRACKING_AVAILABLE:${shipmentId}:`)),
    }));
  });

  test('delivered status sets deliveredAt and marks parent order delivered', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });

    const result = await service.updateStatus(shipmentId, { status: 'DELIVERED' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(shipmentId, 'SHIPPED', expect.objectContaining({
      status: 'DELIVERED',
      deliveredAt: expect.any(Date),
    }));
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalledWith(orderItemId, 'DELIVERED', expect.anything());
    expect(orderPublic.markOrderDelivered).toHaveBeenCalledWith(orderId, expect.any(Date), {
      source: 'SHIPMENT',
    });
    expect(orderPublic.updateOrderWorkbenchItem).toHaveBeenCalledWith(
      orderId,
      orderItemId,
      { tracking: expect.objectContaining({ status: 'DELIVERED' }) },
      { source: 'SHIPMENT' },
    );
    expect(result.status).toBe('DELIVERED');
  });

  test('records only non-content status reason metadata', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });

    await service.updateStatus(shipmentId, { status: 'EXCEPTION', note: 'Carrier exception' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SHIPMENT_STATUS_UPDATED',
      changes: expect.objectContaining({ reasonProvided: true }),
    }), {});
  });

  test('keeps a shipment note in domain state but excludes credential, PII, and tracking sentinels from audit', async () => {
    const note = 'token=shipment_secret_SENTINEL buyer=shipment.person@example.test tracking=TRACK-SHIP-6655';
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });

    await service.updateStatus(shipmentId, { status: 'EXCEPTION', note }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(shipmentId, 'SHIPPED', expect.objectContaining({ note }));
    const auditPayload = JSON.stringify(auditPublic.record.mock.calls[0][0]);
    expect(auditPayload).not.toContain('shipment_secret_SENTINEL');
    expect(auditPayload).not.toContain('shipment.person@example.test');
    expect(auditPayload).not.toContain('TRACK-SHIP-6655');
  });

  test('distinguishes same-millisecond shipment writes and reuses the key for exact persisted replay', async () => {
    const before = { ...shipment, status: 'SHIPPED' };
    const updatedAt = new Date('2026-07-29T04:00:00.000Z');
    repository.findById.mockResolvedValue(before);
    repository.updateStatusIfCurrent
      .mockResolvedValueOnce({ ...shipment, status: 'EXCEPTION', updatedAt, __v: 6 })
      .mockResolvedValueOnce({ ...shipment, status: 'EXCEPTION', updatedAt, __v: 7 })
      .mockResolvedValueOnce({ ...shipment, status: 'EXCEPTION', updatedAt, __v: 7 });

    await service.updateStatus(shipmentId, { status: 'EXCEPTION' }, {
      permissions: ['SHIPMENTS:WRITE'], worker: true,
    });
    await service.updateStatus(shipmentId, { status: 'EXCEPTION' }, {
      permissions: ['SHIPMENTS:WRITE'], worker: true,
    });
    await service.updateStatus(shipmentId, { status: 'EXCEPTION' }, {
      permissions: ['SHIPMENTS:WRITE'], worker: true,
    });

    const keys = auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey);
    expect(keys).toHaveLength(3);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
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

  test('ignores cancelled sibling items when checking parent-order delivery', async () => {
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

  test('does not mark an order delivered while a non-cancelled sibling shipment is pending', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
    const otherOrderItemId = '660000000000000000130007';
    orderPublic.listItemsByOrder.mockResolvedValueOnce([
      { _id: orderItemId, status: 'SHIPPED' },
      { _id: otherOrderItemId, status: 'SHIPPED' },
    ]);
    repository.listByOrderItemIds.mockResolvedValueOnce([
      { ...shipment, orderItemId, status: 'DELIVERED' },
      { ...shipment, _id: '660000000000000000130008', orderItemId: otherOrderItemId, status: 'TRACKING_PENDING' },
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

  test('replaying the same tracking on a delivered shipment repairs order side effects', async () => {
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
    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'SHIPPED', {
      source: 'SHIPMENT',
    });
    expect(orderPublic.appendTimelineOnce).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'TRACKING_AVAILABLE',
      idempotencyKey: expect.stringMatching(new RegExp(`^SHIPMENT_TRACKING_AVAILABLE:${shipmentId}:`)),
    }));
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
    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
  });

  test('does not change a tracking-pending shipment when carrier or tracking is incomplete', async () => {
    await expect(service.updateTracking(shipmentId, {
      carrier: 'USPS',
    }, { permissions: ['SHIPMENTS:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
  });

  test('replaying the same shipped tracking repairs side effects without a tracking write', async () => {
    repository.findById.mockResolvedValueOnce({
      ...shipment,
      status: 'SHIPPED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    });

    await service.updateTracking(shipmentId, {
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'SHIPPED', {
      source: 'SHIPMENT',
    });
    expect(orderPublic.appendTimelineOnce).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'TRACKING_AVAILABLE',
      idempotencyKey: expect.stringMatching(new RegExp(`^SHIPMENT_TRACKING_AVAILABLE:${shipmentId}:`)),
    }));
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

  test('rejects direct exception from tracking pending', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'TRACKING_PENDING' });

    await expect(service.updateStatus(shipmentId, { status: 'EXCEPTION' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.updateStatusIfCurrent).not.toHaveBeenCalled();
  });

  test('transitions shipped shipment to returned and appends one returned timeline event', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });

    const result = await service.updateStatus(shipmentId, { status: 'RETURNED' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(result.status).toBe('RETURNED');
    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(shipmentId, 'SHIPPED', expect.objectContaining({
      status: 'RETURNED',
    }));
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderPublic.appendTimelineOnce).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'SHIPMENT_RETURNED',
      idempotencyKey: `SHIPMENT_STATUS:${shipmentId}:RETURNED`,
    }));
  });

  test('transitions shipped shipment to exception and appends one exception timeline event', async () => {
    const updatedAt = new Date('2026-07-28T07:00:00.000Z');
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
    repository.updateStatusIfCurrent.mockImplementationOnce(async (_id, _currentStatus, patch) => ({
      ...shipment,
      ...patch,
      updatedAt,
    }));

    const result = await service.updateStatus(shipmentId, { status: 'EXCEPTION' }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(result.status).toBe('EXCEPTION');
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderPublic.appendTimelineOnce).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'SHIPMENT_EXCEPTION',
      idempotencyKey: `SHIPMENT_STATUS:${shipmentId}:EXCEPTION`,
    }));
    expect(notificationPublic.notify).toHaveBeenCalledWith({
      recipientAccountId: assignedStaffId,
      type: 'SHIPMENT_EXCEPTION',
      title: 'Shipment exception',
      message: 'A shipment for your order has an exception and needs attention.',
      relatedResource: { type: 'shipment', id: shipmentId },
      deduplicationKey: `SHIPMENT_EXCEPTION:${shipmentId}:${assignedStaffId}:${updatedAt.toISOString()}`,
    });
  });

  test('replaying shipment exception does not notify again', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'EXCEPTION' });

    await expect(service.updateStatus(shipmentId, { status: 'EXCEPTION' }, {
      permissions: ['SHIPMENTS:WRITE'],
    })).resolves.toMatchObject({ status: 'EXCEPTION' });

    expect(notificationPublic.notify).not.toHaveBeenCalled();
  });

  test('notifies every distinct assigned staff member once', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
    orderPublic.findById.mockResolvedValueOnce({ _id: orderId, assignedStaffIds: [assignedStaffId, actorId, assignedStaffId] });
    await service.updateStatus(shipmentId, { status: 'EXCEPTION' }, { permissions: ['SHIPMENTS:WRITE'] });
    expect(notificationPublic.notify).toHaveBeenCalledTimes(2);
    expect(notificationPublic.notify.mock.calls.map(([payload]) => payload.recipientAccountId)).toEqual([assignedStaffId, actorId]);
  });

  test('skips shipment exception notification when the order has no assignee', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
    orderPublic.findById.mockResolvedValueOnce({ _id: orderId, assignedStaffIds: [] });

    await expect(service.updateStatus(shipmentId, { status: 'EXCEPTION' }, {
      permissions: ['SHIPMENTS:WRITE'],
    })).resolves.toMatchObject({ status: 'EXCEPTION' });

    expect(notificationPublic.notify).not.toHaveBeenCalled();
  });

  test('keeps shipment exception persisted when owner lookup fails', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
    orderPublic.findById.mockRejectedValueOnce(Object.assign(new Error('order unavailable'), { code: 'ORDER_UNAVAILABLE' }));

    await expect(service.updateStatus(shipmentId, { status: 'EXCEPTION' }, {
      permissions: ['SHIPMENTS:WRITE'],
    })).resolves.toMatchObject({ status: 'EXCEPTION' });

    expect(logger.warn).toHaveBeenCalledWith('shipment_notification_failed', {
      shipmentId,
      errorCode: 'ORDER_UNAVAILABLE',
    });
  });

  test('keeps shipment exception persisted when notification delivery fails', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
    notificationPublic.notify.mockResolvedValueOnce({ delivered: false, errorCode: 'INTERNAL_SERVER_ERROR' });

    await expect(service.updateStatus(shipmentId, { status: 'EXCEPTION' }, {
      permissions: ['SHIPMENTS:WRITE'],
    })).resolves.toMatchObject({ status: 'EXCEPTION' });
  });

  test('does not mutate returned shipment tracking and accepts same returned status', async () => {
    const returnedShipment = {
      ...shipment,
      status: 'RETURNED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    };
    repository.findById.mockResolvedValue(returnedShipment);

    await expect(service.updateTracking(shipmentId, {
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    }, { permissions: ['SHIPMENTS:WRITE'] })).resolves.toMatchObject({
      id: shipmentId,
      status: 'RETURNED',
    });
    await expect(service.updateStatus(shipmentId, { status: 'RETURNED' }, {
      permissions: ['SHIPMENTS:WRITE'],
    })).resolves.toMatchObject({ id: shipmentId, status: 'RETURNED' });

    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
    expect(repository.updateStatusIfCurrent).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
  });

  test('does not reopen a cancelled shipment with tracking', async () => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'CANCELLED' });

    await expect(service.updateTracking(shipmentId, {
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    }, { permissions: ['SHIPMENTS:WRITE'] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
  });

  test('acknowledges non-cancelled vendor tracking for a cancelled shipment', async () => {
    const cancelledShipment = { ...shipment, status: 'CANCELLED' };
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(cancelledShipment);
    getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockResolvedValue({
        provider: 'MERCHIZE',
        carrier: 'USPS',
        trackingNumber: '9214490411375403131206',
        vendorStatus: 'shipped',
      }),
    });

    await expect(service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId })).resolves.toMatchObject({
      applied: true,
      shipment: { id: shipmentId, status: 'CANCELLED' },
    });

    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
  });

  test.each(['DELIVERED', 'RETURNED'])('acknowledges a late vendor cancellation for terminal %s shipment', async (status) => {
    repository.findActiveByVendorSubmission.mockResolvedValueOnce({ ...shipment, status });
    getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockResolvedValue({
        provider: 'MERCHIZE',
        carrier: 'USPS',
        trackingNumber: '9214490411375403131206',
        vendorStatus: 'cancelled',
      }),
    });

    await expect(service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId })).resolves.toMatchObject({
      applied: true,
      shipment: { id: shipmentId, status },
    });

    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
    expect(repository.updateStatusIfCurrent).not.toHaveBeenCalled();
  });

  test('applies returned canonical vendor tracking status after tracking update', async () => {
    repository.findById
      .mockResolvedValueOnce(shipment)
      .mockResolvedValueOnce({ ...shipment, status: 'SHIPPED' });
    getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockResolvedValue({
        provider: 'MERCHIZE',
        carrier: 'USPS',
        trackingNumber: '9214490411375403131206',
        vendorStatus: 'return_to_sender',
      }),
    });

    const result = await service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId });

    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(shipmentId, 'SHIPPED', expect.objectContaining({
      status: 'RETURNED',
    }));
    expect(result.shipment.status).toBe('RETURNED');
  });

  test.each(['EXCEPTION', 'RETURNED', 'CANCELLED'])('rejects terminal delivery transition to %s', async (status) => {
    repository.findById.mockResolvedValueOnce({ ...shipment, status: 'DELIVERED' });

    await expect(service.updateStatus(shipmentId, { status }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.updateStatusIfCurrent).not.toHaveBeenCalled();
  });

  test('summarizes shipped shipments by order item ids in one repository call', async () => {
    const result = await service.summarizeShippedByOrderItemIds([
      orderItemId,
      orderItemId,
    ]);

    expect(repository.summarizeShippedByOrderItemIds).toHaveBeenCalledWith([orderItemId]);
    expect(result).toEqual({ [orderItemId]: 1 });
  });

  test('rejects a scoped tracking probe without a submission before vendor fetch', async () => {
    const adapter = getTrackingAdapter.mock.results[0]?.value || {
      fetchTrackingByExternalOrderId: jest.fn(),
    };
    getTrackingAdapter.mockReturnValue(adapter);

    await expect(service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
    }, {
      permissions: [],
      scopes: [{
        scopeType: 'shop',
        scopeId: shopId,
        permissions: ['SHIPMENTS:WRITE'],
      }],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    expect(adapter.fetchTrackingByExternalOrderId).not.toHaveBeenCalled();
  });

  test('authorizes a submitted tracking probe before vendor fetch', async () => {
    const adapter = { fetchTrackingByExternalOrderId: jest.fn() };
    getTrackingAdapter.mockReturnValue(adapter);
    authPublic.canAccessScope.mockReturnValueOnce(false);

    await expect(service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, {
      permissions: [],
      scopes: [],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    expect(vendorSubmissionPublic.getById).toHaveBeenCalledWith(vendorSubmissionId);
    expect(adapter.fetchTrackingByExternalOrderId).not.toHaveBeenCalled();
  });

  test('vendor tracking recheck without submission is rejected before vendor fetch', async () => {
    await expect(service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-07-17T23:59:59.999Z',
    }, { permissions: ['SHIPMENTS:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(getTrackingAdapter).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
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
    expect(repository.updateTrackingIfNotDelivered).toHaveBeenCalledWith(shipmentId, expect.objectContaining({
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
    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'TRACKING_PENDING', {
      source: 'SHIPMENT',
    });
    expect(result).toMatchObject({
      applied: false,
      reason: 'TRACKING_NOT_FOUND',
      shipment: { id: shipmentId, status: 'TRACKING_PENDING' },
    });
  });

  test('applies returned recheck status without new tracking only to an existing shipped shipment', async () => {
    const shippedShipment = {
      ...shipment,
      status: 'SHIPPED',
      carrier: 'USPS',
      trackingNumber: '9214490411375403131206',
    };
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(shippedShipment);
    repository.findById.mockResolvedValueOnce(shippedShipment);
    getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockResolvedValue({
        provider: 'MERCHIZE',
        vendorStatus: 'return_to_sender',
        trackingNumber: null,
      }),
    });

    const result = await service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId });

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(shipmentId, 'SHIPPED', expect.objectContaining({
      status: 'RETURNED',
    }));
    expect(result).toMatchObject({ applied: true, shipment: { status: 'RETURNED' } });
  });

  test('applies a returned recheck from an exception shipment without replacing its tracking', async () => {
    const exceptionShipment = {
      ...shipment,
      status: 'EXCEPTION',
      carrier: 'USPS',
      trackingNumber: '9214490411375403131206',
    };
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(exceptionShipment);
    repository.findById.mockResolvedValueOnce(exceptionShipment);
    getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockResolvedValue({
        provider: 'MERCHIZE',
        carrier: 'UPS',
        trackingNumber: '1Z999AA10123456784',
        vendorStatus: 'return_to_sender',
      }),
    });

    await expect(service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId })).resolves.toMatchObject({
      applied: true,
      shipment: { status: 'RETURNED' },
    });

    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
  });

  test('treats a no-tracking returned recheck as idempotent after return', async () => {
    const returnedShipment = { ...shipment, status: 'RETURNED' };
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(returnedShipment);
    getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockResolvedValue({
        provider: 'MERCHIZE',
        vendorStatus: 'return_to_sender',
        trackingNumber: null,
      }),
    });

    await expect(service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId })).resolves.toMatchObject({
      applied: true,
      shipment: { status: 'RETURNED' },
    });

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
  });

  test('updates a changed tracking number even when the vendor status remains shipped', async () => {
    const shippedShipment = {
      ...shipment,
      status: 'SHIPPED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
      trackingUrl: 'https://tracking.test/old',
    };
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(shippedShipment);
    repository.findById.mockResolvedValueOnce(shippedShipment);
    repository.updateTrackingIfNotDelivered.mockImplementationOnce(async (_id, patch) => ({
      ...shippedShipment,
      ...patch,
    }));

    await service.applyTrackingUpdate(vendorSubmissionId, {
      carrier: 'USPS',
      trackingNumber: '9400111899223850000002',
      trackingUrl: 'https://tracking.test/new',
      shipmentStatus: 'SHIPPED',
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId });

    expect(repository.updateTrackingIfNotDelivered).toHaveBeenCalledWith(shipmentId, expect.objectContaining({
      trackingNumber: '9400111899223850000002',
      trackingUrl: 'https://tracking.test/new',
    }));
    expect(orderPublic.appendTimelineOnce).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(new RegExp(`^SHIPMENT_TRACKING_AVAILABLE:${shipmentId}:`)),
    }));
  });

  test('does not write shipment history when the tracking fingerprint is unchanged', async () => {
    const shippedShipment = {
      ...shipment,
      status: 'SHIPPED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
      trackingUrl: 'https://tracking.test/same',
    };
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(shippedShipment);

    const result = await service.applyTrackingUpdate(vendorSubmissionId, {
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
      trackingUrl: 'https://tracking.test/same',
      shipmentStatus: 'SHIPPED',
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId });

    expect(result).toMatchObject({ applied: true, shipment: { id: shipmentId, status: 'SHIPPED' } });
    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
    expect(orderPublic.appendTimelineOnce).not.toHaveBeenCalled();
  });

  test('updates a changed tracking URL even when the vendor status remains shipped', async () => {
    const shippedShipment = {
      ...shipment,
      status: 'SHIPPED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
      trackingUrl: 'https://tracking.test/old',
    };
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(shippedShipment);
    repository.findById.mockResolvedValueOnce(shippedShipment);
    repository.updateTrackingIfNotDelivered.mockImplementationOnce(async (_id, patch) => ({
      ...shippedShipment,
      ...patch,
    }));

    await service.applyTrackingUpdate(vendorSubmissionId, {
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
      trackingUrl: 'https://tracking.test/new',
      shipmentStatus: 'SHIPPED',
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId });

    expect(repository.updateTrackingIfNotDelivered).toHaveBeenCalledWith(shipmentId, expect.objectContaining({
      trackingUrl: 'https://tracking.test/new',
    }));
  });

  test('creates a new timeline entry when the carrier changes with the same tracking number', async () => {
    const shippedShipment = {
      ...shipment,
      status: 'SHIPPED',
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
      trackingUrl: 'https://tracking.test/old',
    };
    repository.findActiveByVendorSubmission.mockResolvedValueOnce(shippedShipment);
    repository.findById.mockResolvedValueOnce(shippedShipment);
    repository.updateTrackingIfNotDelivered.mockImplementationOnce(async (_id, patch) => ({
      ...shippedShipment,
      ...patch,
    }));

    await service.applyTrackingUpdate(vendorSubmissionId, {
      carrier: 'UPS',
      trackingNumber: '9400111899223850000001',
      trackingUrl: 'https://tracking.test/old',
      shipmentStatus: 'SHIPPED',
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId });

    expect(orderPublic.appendTimelineOnce).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `SHIPMENT_TRACKING_AVAILABLE:${shipmentId}:72fedf95f865fc980fafedceb92786df`,
    }));
  });

  test('records the last successful vendor tracking check on the shipment', async () => {
    await service.recheckVendorTracking({ vendorSubmissionId }, {
      permissions: ['SHIPMENTS:WRITE'],
      accountId: actorId,
    });

    expect(repository.touchLastCheckedAtByVendorSubmission)
      .toHaveBeenCalledWith(vendorSubmissionId, expect.any(Date));
  });

  test('does not recheck tracking when the vendor integration is missing', async () => {
    vendorPublic.getVendorIntegrationAssignment.mockResolvedValueOnce(null);

    await expect(service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId })).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(getTrackingAdapter).not.toHaveBeenCalled();
    expect(vendorPublic.getVendorIntegrationCredential).not.toHaveBeenCalled();
  });

  test('does not recheck tracking for a disconnected integration', async () => {
    vendorPublic.getVendorIntegrationAssignment.mockResolvedValueOnce({
      providerKey: 'MERCHIZE', status: 'DISCONNECTED',
    });

    await expect(service.recheckVendorTracking({
      provider: 'MERCHIZE',
      externalOrderId: '112-7237034-7096265',
      vendorSubmissionId,
    }, { permissions: ['SHIPMENTS:WRITE'], accountId: actorId })).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(getTrackingAdapter).not.toHaveBeenCalled();
    expect(vendorPublic.getVendorIntegrationCredential).not.toHaveBeenCalled();
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
    vendorSubmissionPublic.getById.mockResolvedValue({
      ...submittedSubmission,
      provider: 'PRINTWAY',
      vendorExternalOrderId: '4095267035',
      payloadSnapshot: {
        vendorProduct: { vendor: { id: vendorId, providerKey: 'PRINTWAY' } },
      },
    });
    vendorPublic.getVendorIntegrationAssignment.mockResolvedValue({ providerKey: 'PRINTWAY', status: 'CONNECTED' });
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

  test('submitted vendor tracking batch skips returned shipments', async () => {
    vendorSubmissionPublic.listSubmittedForTracking.mockResolvedValue([{
      id: vendorSubmissionId,
      provider: 'PRINTWAY',
      vendorExternalOrderId: '4095267035',
      orderItemId,
      shopId,
    }]);
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: shipmentId,
      orderItemId,
      status: 'RETURNED',
    });

    const result = await service.recheckSubmittedVendorTracking({}, {
      permissions: ['SHIPMENTS:WRITE'],
    });

    expect(result).toMatchObject({ checked: 1, applied: 0, skipped: 1, failed: 0 });
    expect(result.items).toEqual([expect.objectContaining({
      status: 'SKIPPED',
      reason: 'SHIPMENT_RETURNED',
    })]);
  });

  test('submitted vendor tracking batch skips cancelled shipments without provider or update calls', async () => {
    const fetchTrackingByExternalOrderId = jest.fn();
    vendorSubmissionPublic.listSubmittedForTracking.mockResolvedValue([{
      id: vendorSubmissionId,
      provider: 'PRINTWAY',
      vendorExternalOrderId: '4095267035',
      orderItemId,
      shopId,
    }]);
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: shipmentId,
      orderItemId,
      status: 'CANCELLED',
    });
    getTrackingAdapter.mockReturnValueOnce({ fetchTrackingByExternalOrderId });

    const result = await service.recheckSubmittedVendorTracking({}, {
      permissions: ['SHIPMENTS:WRITE'],
    });

    expect(result).toMatchObject({ checked: 1, applied: 0, skipped: 1, failed: 0 });
    expect(result.items).toEqual([expect.objectContaining({
      status: 'SKIPPED',
      reason: 'SHIPMENT_CANCELLED',
    })]);
    expect(fetchTrackingByExternalOrderId).not.toHaveBeenCalled();
    expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
    expect(repository.updateStatusIfCurrent).not.toHaveBeenCalled();
  });

  test('keeps processing remaining submissions after one vendor adapter failure', async () => {
    const validOrderItemId = '660000000000000000130014';
    vendorSubmissionPublic.listSubmittedForTracking.mockResolvedValue([
      {
        id: vendorSubmissionId,
        provider: 'PRINTWAY',
        vendorExternalOrderId: '4095267035',
        orderItemId,
        shopId,
      },
      {
        id: '660000000000000000130015',
        provider: 'MERCHIZE',
        vendorExternalOrderId: 'MZ-ORDER-2',
        orderItemId: validOrderItemId,
        shopId,
      },
    ]);
    vendorSubmissionPublic.getById.mockImplementation(async (id) => ({
      ...submittedSubmission,
      id,
      orderItemId: id === vendorSubmissionId ? orderItemId : validOrderItemId,
      provider: id === vendorSubmissionId ? 'PRINTWAY' : 'MERCHIZE',
      vendorExternalOrderId: id === vendorSubmissionId ? '4095267035' : 'MZ-ORDER-2',
      payloadSnapshot: {
        vendorProduct: {
          vendor: { id: vendorId, providerKey: id === vendorSubmissionId ? 'PRINTWAY' : 'MERCHIZE' },
        },
      },
    }));
    vendorPublic.getVendorIntegrationAssignment
      .mockResolvedValueOnce({ providerKey: 'PRINTWAY', status: 'CONNECTED' })
      .mockResolvedValueOnce({ providerKey: 'MERCHIZE', status: 'CONNECTED' });
    getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockRejectedValue(Object.assign(new Error('vendor down'), {
        vendorHttpStatus: 502,
      })),
    });

    const result = await service.recheckSubmittedVendorTracking({}, {
      permissions: ['SHIPMENTS:WRITE'],
    });

    expect(result).toMatchObject({
      checked: 2,
      applied: 1,
      skipped: 0,
      failed: 1,
    });
    expect(result.items.map((row) => row.status)).toEqual(['FAILED', 'APPLIED']);
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
