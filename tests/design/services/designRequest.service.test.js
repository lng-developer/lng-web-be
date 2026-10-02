jest.mock('../../../src/modules/design/repositories/designRequest.repository', () => ({
  findActiveByOrderItemAndType: jest.fn(),
  create: jest.fn(),
}));

const repository = require('../../../src/modules/design/repositories/designRequest.repository');
const service = require('../../../src/modules/design/services/designRequest.service');

describe('designRequest.service', () => {
  const payload = {
    orderId: '660000000000000000000101', orderItemId: '660000000000000000000102', shopId: '660000000000000000000103',
    requestedByAccountId: '660000000000000000000104', note: 'Need PSD', listingSnapshot: { sku: 'SKU-1', title: 'Safe title' },
  };

  beforeEach(() => jest.clearAllMocks());

  test('returns the existing active request instead of creating a duplicate', async () => {
    repository.findActiveByOrderItemAndType.mockResolvedValue({ _id: '660000000000000000000105', ...payload, requestType: 'PSD_TEMPLATE', status: 'PENDING_ASSIGNMENT' });
    await expect(service.createOrderDesignRequest(payload)).resolves.toMatchObject({ id: '660000000000000000000105', status: 'PENDING_ASSIGNMENT' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  test('creates a new request after a terminal request and exposes only safe snapshot fields', async () => {
    repository.findActiveByOrderItemAndType.mockResolvedValue(null);
    repository.create.mockResolvedValue({ _id: '660000000000000000000105', ...payload, requestType: 'PSD_TEMPLATE', status: 'PENDING_ASSIGNMENT', listingSnapshot: { sku: 'SKU-1', title: 'Safe title', rawPayload: 'nope' } });
    const result = await service.createOrderDesignRequest(payload);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING_ASSIGNMENT', requestType: 'PSD_TEMPLATE' }));
    expect(result).toEqual(expect.objectContaining({ listingSnapshot: expect.objectContaining({ sku: 'SKU-1', title: 'Safe title' }) }));
    expect(result.listingSnapshot.rawPayload).toBeUndefined();
  });
});
