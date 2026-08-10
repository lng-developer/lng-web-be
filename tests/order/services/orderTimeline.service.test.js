jest.mock('../../../src/modules/order/repositories/orderTimeline.repository', () => ({
  create: jest.fn(),
  createOnce: jest.fn(),
  listByOrder: jest.fn(),
  listByOrderItem: jest.fn(),
}));

const repository = require('../../../src/modules/order/repositories/orderTimeline.repository');
const service = require('../../../src/modules/order/services/orderTimeline.service');

describe('orderTimeline.service', () => {
  const payload = {
    orderId: '660000000000000000140001',
    orderItemId: '660000000000000000140002',
    shopId: '660000000000000000140003',
    eventType: 'TRACKING_AVAILABLE',
    source: 'SHIPMENT',
    metadata: { carrier: 'USPS' },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    repository.createOnce.mockResolvedValue({ _id: '660000000000000000140004' });
  });

  test('appends a timeline entry once by idempotency key', async () => {
    const entry = { ...payload, idempotencyKey: 'SHIPMENT_TRACKING_AVAILABLE:shipment:tracking' };

    await expect(service.appendTimelineOnce(entry)).resolves.toEqual({ _id: '660000000000000000140004' });
    expect(repository.createOnce).toHaveBeenCalledWith(entry);
  });

  test('requires a nonblank idempotency key before creating a timeline entry', async () => {
    await expect(service.appendTimelineOnce({ ...payload, idempotencyKey: '  ' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(repository.createOnce).not.toHaveBeenCalled();
  });
});
