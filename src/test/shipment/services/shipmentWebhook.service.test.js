jest.mock('../../../modules/vendorSubmission/public', () => ({
  getById: jest.fn(),
  getByOrderItemId: jest.fn(),
}));

jest.mock('../../../modules/shipment/services/shipment.service', () => ({
  createFromVendorSubmission: jest.fn(),
  updateStatus: jest.fn(),
  updateTracking: jest.fn(),
}));

jest.mock('../../../modules/shipment/repositories/vendorWebhookLog.repository', () => ({
  create: jest.fn(),
  list: jest.fn(),
}));

const vendorSubmissionPublic = require('../../../modules/vendorSubmission/public');
const shipmentService = require('../../../modules/shipment/services/shipment.service');
const webhookLogRepository = require('../../../modules/shipment/repositories/vendorWebhookLog.repository');
const service = require('../../../modules/shipment/services/shipmentWebhook.service');

describe('shipmentWebhook.service', () => {
  const originalEnv = process.env;
  const vendorSubmissionId = '660000000000000000130002';
  const orderItemId = '660000000000000000130004';
  const shipmentId = '660000000000000000130001';
  const submission = {
    id: vendorSubmissionId,
    orderId: '660000000000000000130003',
    orderItemId,
    shopId: '660000000000000000130005',
    status: 'SUBMITTED',
  };

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
    process.env = { ...originalEnv, VENDOR_WEBHOOK_SECRET_PRINTWAY: 'secret', VENDOR_WEBHOOK_SECRET: 'fallback' };
    vendorSubmissionPublic.getById.mockResolvedValue(submission);
    vendorSubmissionPublic.getByOrderItemId.mockResolvedValue(submission);
    shipmentService.createFromVendorSubmission.mockResolvedValue({ id: shipmentId, status: 'TRACKING_PENDING' });
    shipmentService.updateTracking.mockResolvedValue({ id: shipmentId, status: 'SHIPPED' });
    shipmentService.updateStatus.mockResolvedValue({ id: shipmentId, status: 'DELIVERED' });
    webhookLogRepository.create.mockResolvedValue({});
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('rejects invalid shared secret', async () => {
    await expect(service.receiveVendorWebhook('printway', req({ secret: 'bad' })))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    expect(shipmentService.updateTracking).not.toHaveBeenCalled();
  });

  test('applies tracking webhook and logs success', async () => {
    const result = await service.receiveVendorWebhook('printway', req({
      body: {
        vendorSubmissionId,
        data: {
          tracking: {
            trackingNumber: '9400111899223850000001',
            carrierName: 'USPS',
          },
          status: 'shipped',
        },
      },
    }));

    expect(result.statusCode).toBe(200);
    expect(shipmentService.createFromVendorSubmission).toHaveBeenCalledWith(vendorSubmissionId, expect.objectContaining({
      permissions: ['SHIPMENTS:WRITE'],
      system: true,
      source: 'VENDOR_WEBHOOK',
    }));
    expect(shipmentService.updateTracking).toHaveBeenCalledWith(shipmentId, expect.objectContaining({
      carrier: 'USPS',
      trackingNumber: '9400111899223850000001',
    }), expect.objectContaining({ system: true }));
    expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'PRINTWAY',
      outcome: 'SUCCESS',
      trackingNumber: '9400111899223850000001',
      carrier: 'USPS',
    }));
  });

  test('marks delivered when vendor status is delivered', async () => {
    await service.receiveVendorWebhook('printway', req({
      body: {
        vendorSubmissionId,
        trackingNumber: '9400111899223850000001',
        status: 'delivered',
      },
    }));

    expect(shipmentService.updateStatus).toHaveBeenCalledWith(shipmentId, { status: 'DELIVERED' }, expect.objectContaining({ system: true }));
  });

  test('returns accepted and logs skipped when submission is missing', async () => {
    vendorSubmissionPublic.getByOrderItemId.mockResolvedValueOnce(null);

    const result = await service.receiveVendorWebhook('printway', req({
      body: {
        orderItemId,
        trackingNumber: '9400111899223850000001',
      },
    }));

    expect(result).toMatchObject({
      statusCode: 202,
      data: { reason: 'SUBMISSION_NOT_FOUND' },
    });
    expect(shipmentService.createFromVendorSubmission).not.toHaveBeenCalled();
    expect(webhookLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'SKIPPED',
      message: 'SUBMISSION_NOT_FOUND',
    }));
  });

  test('logs processing errors before rethrowing', async () => {
    shipmentService.updateTracking.mockRejectedValueOnce(Object.assign(new Error('boom'), {
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
});
