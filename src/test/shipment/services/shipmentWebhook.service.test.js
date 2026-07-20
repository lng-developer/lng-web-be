jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/order/public', () => ({
  appendTimeline: jest.fn(),
  findItemById: jest.fn(),
  listItemsByOrder: jest.fn(),
  markOrderDelivered: jest.fn(),
  transitionItemStatus: jest.fn(),
}));

jest.mock('../../../modules/vendorSubmission/public', () => ({
  getById: jest.fn(),
  getByOrderItemId: jest.fn(),
  getByProviderExternalOrderId: jest.fn(),
}));

jest.mock('../../../modules/shipment/repositories/shipment.repository', () => ({
  create: jest.fn(),
  findActiveByVendorSubmission: jest.fn(),
  findById: jest.fn(),
  listByOrderItemIds: jest.fn(),
  updateById: jest.fn(),
  updateTrackingIfNotDelivered: jest.fn(),
}));

jest.mock('../../../modules/shipment/repositories/vendorWebhookLog.repository', () => ({
  create: jest.fn(),
  list: jest.fn(),
}));

jest.mock('../../../modules/shipment/services/vendorTrackingAdapterRegistry.service', () => ({
  getTrackingAdapter: jest.fn(),
}));

const orderPublic = require('../../../modules/order/public');
const vendorSubmissionPublic = require('../../../modules/vendorSubmission/public');
const shipmentRepository = require('../../../modules/shipment/repositories/shipment.repository');
const webhookLogRepository = require('../../../modules/shipment/repositories/vendorWebhookLog.repository');
const { getTrackingAdapter } = require('../../../modules/shipment/services/vendorTrackingAdapterRegistry.service');
const service = require('../../../modules/shipment/services/shipmentWebhook.service');

describe('shipmentWebhook.service', () => {
  const originalEnv = process.env;
  const vendorSubmissionId = '660000000000000000130002';
  const orderId = '660000000000000000130003';
  const orderItemId = '660000000000000000130004';
  const shipmentId = '660000000000000000130001';
  const submission = {
    id: vendorSubmissionId,
    orderId,
    orderItemId,
    shopId: '660000000000000000130005',
    status: 'SUBMITTED',
  };
  const item = {
    _id: orderItemId,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
  };
  let shipments;

  function copyShipment(shipment) {
    return shipment ? { ...shipment } : null;
  }

  function normalizeTracking(provider, body = {}) {
    const root = body.data || body;
    const tracking = root.tracking || root;
    const vendorStatus = String(root.status || body.status || '').toLowerCase();
    return {
      provider: String(provider).toUpperCase(),
      vendorSubmissionId: body.vendorSubmissionId || root.vendorSubmissionId || '',
      orderItemId: body.orderItemId || root.orderItemId || '',
      vendorExternalOrderId: body.order_id || root.order_id || '',
      trackingNumber: tracking.trackingNumber || tracking.tracking_number || '',
      carrier: tracking.carrier || tracking.carrierName || tracking.carrier_name || '',
      trackingUrl: tracking.trackingUrl || tracking.tracking_url || '',
      vendorStatus,
      delivered: vendorStatus === 'delivered',
    };
  }

  function req({ body = {}, provider = 'printway', secret = 'secret' } = {}) {
    return {
      body,
      headers: {
        'x-vendor-webhook-secret': secret,
        'user-agent': 'jest',
      },
      query: {},
      params: { provider },
      method: 'POST',
      originalUrl: `/vendor-webhooks/${provider}`,
      ip: '127.0.0.1',
    };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    shipments = [];
    process.env = {
      ...originalEnv,
      VENDOR_WEBHOOK_SECRET_MERCHIZE: 'test-secret',
      VENDOR_WEBHOOK_SECRET_PRINTWAY: 'secret',
      VENDOR_WEBHOOK_SECRET: 'fallback',
    };
    vendorSubmissionPublic.getById.mockResolvedValue(submission);
    vendorSubmissionPublic.getByOrderItemId.mockResolvedValue(submission);
    vendorSubmissionPublic.getByProviderExternalOrderId.mockResolvedValue(submission);
    orderPublic.findItemById.mockResolvedValue(item);
    orderPublic.listItemsByOrder.mockResolvedValue([item]);
    orderPublic.markOrderDelivered.mockResolvedValue({});
    orderPublic.transitionItemStatus.mockResolvedValue({});
    orderPublic.appendTimeline.mockResolvedValue({});
    shipmentRepository.findActiveByVendorSubmission.mockImplementation(async (id) => (
      copyShipment(shipments.find((shipment) => shipment.vendorSubmissionId === id))
    ));
    shipmentRepository.create.mockImplementation(async (payload) => {
      const shipment = { _id: shipmentId, ...payload };
      shipments.push(shipment);
      return copyShipment(shipment);
    });
    shipmentRepository.findById.mockImplementation(async (id) => (
      copyShipment(shipments.find((shipment) => String(shipment._id) === String(id)))
    ));
    shipmentRepository.updateById.mockImplementation(async (id, patch) => {
      const shipment = shipments.find((entry) => String(entry._id) === String(id));
      Object.assign(shipment, patch);
      return copyShipment(shipment);
    });
    shipmentRepository.updateTrackingIfNotDelivered.mockImplementation(async (id, patch) => {
      const shipment = shipments.find((entry) => String(entry._id) === String(id));
      if (shipment.status === 'DELIVERED') return null;
      Object.assign(shipment, patch);
      return copyShipment(shipment);
    });
    shipmentRepository.listByOrderItemIds.mockImplementation(async (ids) => (
      shipments
        .filter((shipment) => ids.map(String).includes(String(shipment.orderItemId)))
        .map(copyShipment)
    ));
    webhookLogRepository.create.mockResolvedValue({});
    getTrackingAdapter.mockReturnValue({ normalizeTracking });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('rejects invalid shared secret', async () => {
    await expect(service.receiveVendorWebhook('printway', req({ secret: 'bad' })))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    expect(shipments).toEqual([]);
  });

  test('applies tracking webhook and logs success', async () => {
    const result = await service.receiveVendorWebhook('printway', req({
      body: {
        vendorSubmissionId,
        trackingNumber: '9400111899223850000001',
        carrier: 'USPS',
        status: 'shipped',
      },
    }));

    expect(result).toMatchObject({ statusCode: 200, data: { shipmentId, status: 'SHIPPED' } });
    expect(shipments).toEqual([expect.objectContaining({
      _id: shipmentId,
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
      status: 'SHIPPED',
    })]);
    expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'PRINTWAY',
      outcome: 'SUCCESS',
      shopId: submission.shopId,
      trackingNumber: '9400111899223850000001',
      carrier: 'USPS',
    }));
  });

  test('marks delivered when vendor status is delivered', async () => {
    const result = await service.receiveVendorWebhook('printway', req({
      body: {
        vendorSubmissionId,
        trackingNumber: '9400111899223850000001',
        status: 'delivered',
      },
    }));

    expect(result).toMatchObject({ statusCode: 200, data: { shipmentId, status: 'DELIVERED' } });
    expect(shipments).toEqual([expect.objectContaining({ status: 'DELIVERED' })]);
  });

  test('keeps one delivered shipment through delayed tracking and replay', async () => {
    const missingTrackingResult = await service.receiveVendorWebhook('MERCHIZE', req({
      provider: 'merchize',
      secret: 'test-secret',
      body: {
        vendorSubmissionId,
        tracking_number: null,
        status: 'delivered',
      },
    }));

    expect(missingTrackingResult).toMatchObject({ statusCode: 202, data: { reason: 'TRACKING_NOT_FOUND' } });
    expect(shipments).toEqual([]);
    expect(webhookLogRepository.create).toHaveBeenLastCalledWith(expect.objectContaining({
      outcome: 'SKIPPED',
      message: 'TRACKING_NOT_FOUND',
    }));

    const deliveredTrackingReq = req({
      provider: 'merchize',
      secret: 'test-secret',
      body: {
        vendorSubmissionId,
        tracking_number: '9400111899223850000001',
        status: 'delivered',
      },
    });
    await service.receiveVendorWebhook('MERCHIZE', deliveredTrackingReq);
    await service.receiveVendorWebhook('MERCHIZE', deliveredTrackingReq);

    expect(shipments).toHaveLength(1);
    expect(shipments).toEqual([expect.objectContaining({
      _id: shipmentId,
      vendorSubmissionId,
      carrier: 'MERCHIZE',
      trackingNumber: '9400111899223850000001',
      status: 'DELIVERED',
    })]);
  });

  test('returns accepted and logs skipped when submission is missing', async () => {
    vendorSubmissionPublic.getByOrderItemId.mockResolvedValueOnce(null);

    const result = await service.receiveVendorWebhook('printway', req({
      body: {
        orderItemId,
        trackingNumber: '9400111899223850000001',
      },
    }));

    expect(result).toMatchObject({ statusCode: 202, data: { reason: 'SUBMISSION_NOT_FOUND' } });
    expect(shipments).toEqual([]);
    expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'SKIPPED',
      message: 'SUBMISSION_NOT_FOUND',
    }));
  });

  test('resolves tracking webhook by provider and vendor external order id', async () => {
    const result = await service.receiveVendorWebhook('printway', req({
      body: {
        order_id: '4095267035',
        tracking_number: '9214490416422001622522',
        tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=9214490416422001622522',
      },
    }));

    expect(result.statusCode).toBe(200);
    expect(vendorSubmissionPublic.getByProviderExternalOrderId).toHaveBeenCalledWith({
      provider: 'PRINTWAY',
      vendorExternalOrderId: '4095267035',
    });
    expect(shipments).toEqual([expect.objectContaining({
      trackingNumber: '9214490416422001622522',
      trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=9214490416422001622522',
    })]);
  });

  test('writes a sanitized skipped log for an unmatched vendor event', async () => {
    vendorSubmissionPublic.getByProviderExternalOrderId.mockResolvedValueOnce(null);

    await service.receiveVendorWebhook('printway', req({
      body: {
        order_id: '4095267035',
        tracking_number: '9214490416422001622522',
        token: 'do-not-log',
      },
    }));

    expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'SKIPPED',
      message: 'SUBMISSION_NOT_FOUND',
      rawPayload: expect.not.objectContaining({ token: expect.anything() }),
    }));
  });

  test('removes nested credential variants from persisted webhook payloads', async () => {
    vendorSubmissionPublic.getByProviderExternalOrderId.mockResolvedValueOnce(null);

    await service.receiveVendorWebhook('printway', req({
      body: {
        order_id: '4095267035',
        metadata: {
          APIKEY: 'do-not-log',
          ApiSecret: 'do-not-log',
          ToKeN: 'do-not-log',
          access_token: 'do-not-log',
          AccessToken: 'do-not-log',
          REFRESH_TOKEN: 'do-not-log',
          refreshToken: 'do-not-log',
          AUTHORIZATION: 'do-not-log',
          Password: 'do-not-log',
          SeCrEt: 'do-not-log',
          retained: 'safe',
        },
        items: [{ accessToken: 'do-not-log', retained: true }],
      },
    }));

    expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      rawPayload: {
        order_id: '4095267035',
        metadata: { retained: 'safe' },
        items: [{ retained: true }],
      },
    }));
  });

  test('stores webhook request paths without query tokens', async () => {
    const request = req();
    request.originalUrl = '/vendor-webhooks/printway?token=do-not-log';

    await service.receiveVendorWebhook('printway', request);

    expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ path: '/vendor-webhooks/printway' }),
    }));
  });

  test('logs processing errors before rethrowing', async () => {
    shipmentRepository.updateTrackingIfNotDelivered.mockRejectedValueOnce(Object.assign(new Error('boom'), {
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    }));

    await expect(service.receiveVendorWebhook('printway', req({
      body: {
        vendorSubmissionId,
        trackingNumber: '9400111899223850000001',
      },
    }))).rejects.toThrow('boom');

    expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'ERROR',
      httpStatus: 409,
      message: 'boom',
    }));
  });

  test('limits webhook logs to a scoped reader shops', async () => {
    webhookLogRepository.list.mockResolvedValue({
      items: [], total: 0, page: 1, limit: 20,
    });

    await expect(service.listWebhookLogs({}, {
      scopes: [{
        scopeType: 'shop',
        scopeId: submission.shopId,
        permissions: ['SHIPMENTS:READ'],
      }],
    })).resolves.toMatchObject({ items: [] });

    expect(webhookLogRepository.list).toHaveBeenCalledWith({ shopIds: [submission.shopId] });
  });

  test('limits webhook logs to a scoped writer shops', async () => {
    webhookLogRepository.list.mockResolvedValue({
      items: [], total: 0, page: 1, limit: 20,
    });

    await service.listWebhookLogs({}, {
      scopes: [{
        scopeType: 'shop',
        scopeId: submission.shopId,
        permissions: ['SHIPMENTS:WRITE'],
      }],
    });

    expect(webhookLogRepository.list).toHaveBeenCalledWith({ shopIds: [submission.shopId] });
  });

  test('allows a global shipment writer to read all webhook logs', async () => {
    webhookLogRepository.list.mockResolvedValue({
      items: [], total: 0, page: 1, limit: 20,
    });

    await service.listWebhookLogs({}, { permissions: ['SHIPMENTS:WRITE'] });

    expect(webhookLogRepository.list).toHaveBeenCalledWith({});
  });
});
