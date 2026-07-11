jest.mock('../../../modules/customization/repositories/customizationPayload.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findByOrderItem: jest.fn(),
  findByOrderItemAndHash: jest.fn(),
  list: jest.fn(),
  updateStatus: jest.fn(),
  updateParsedData: jest.fn(),
}));

jest.mock('../../../modules/order/public', () => ({
  findItemById: jest.fn(),
}));

const repository = require('../../../modules/customization/repositories/customizationPayload.repository');
const orderPublic = require('../../../modules/order/public');
const service = require('../../../modules/customization/services/customizationPayload.service');
const { customizationStatuses } = require('../../../modules/customization/constants/customizationStatuses');
const fs = require('fs');
const path = require('path');

describe('customizationPayload.service', () => {
  const shopId = '660000000000000000000201';
  const otherShopId = '660000000000000000000202';
  const orderId = '660000000000000000000301';
  const orderItemId = '660000000000000000000401';
  const payloadId = '660000000000000000000601';
  const basePayload = {
    orderItemId,
    orderId,
    shopId,
    source: 'AMAZON_EXTENSION_REPORT',
    rawCustomization: { name: 'Jane', color: 'blue' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('global ORDERS:READ lists all payloads', async () => {
    repository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });

    await service.listPayloads({ page: 1, limit: 20 }, { permissions: ['ORDERS:READ'], scopes: [] });

    expect(repository.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  test('scoped ORDERS:READ lists assigned shops only', async () => {
    repository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });

    await service.listPayloads(
      { page: 1, limit: 20 },
      {
        permissions: [],
        scopes: [
          { scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] },
          { scopeType: 'shop', scopeId: otherShopId, permissions: ['ORDERS:WRITE'] },
        ],
      },
    );

    expect(repository.list).toHaveBeenCalledWith({ page: 1, limit: 20, shopIds: [shopId] });
  });

  test('scoped ORDERS:READ returns empty page for out-of-scope shop filter', async () => {
    const result = await service.listPayloads(
      { page: 2, limit: 5, shopId: otherShopId },
      {
        permissions: [],
        scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] }],
      },
    );

    expect(repository.list).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], total: 0, page: 2, limit: 5 });
  });

  test('scoped ORDERS:READ rejects out-of-scope payload detail', async () => {
    repository.findById.mockResolvedValue({ _id: payloadId, shopId: otherShopId });

    await expect(service.getById(payloadId, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] }],
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  test('system context can read payload by order item without user shop scope', async () => {
    repository.findByOrderItem.mockResolvedValue({
      _id: payloadId,
      orderItemId,
      shopId: otherShopId,
      status: customizationStatuses.PARSED,
    });

    await expect(service.getByOrderItem(orderItemId, {
      system: true,
      source: 'PRODUCTION',
    })).resolves.toMatchObject({
      _id: payloadId,
      orderItemId,
    });
  });

  test('scoped ORDERS:WRITE rejects out-of-scope payload update', async () => {
    repository.findById.mockResolvedValue({ _id: payloadId, shopId: otherShopId });

    await expect(service.markFailed(payloadId, {
      errorCode: 'INVALID_RAW_CUSTOMIZATION',
      errorMessage: 'bad payload',
    }, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }],
    })).rejects.toMatchObject({ statusCode: 403 });

    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  test.each([
    ['markNeedsReview', () => service.markNeedsReview(payloadId, 'needs review', { permissions: ['ORDERS:WRITE'] })],
    ['markFailed', () => service.markFailed(payloadId, { errorCode: 'INVALID_RAW_CUSTOMIZATION' }, { permissions: ['ORDERS:WRITE'] })],
    ['markParsed', () => service.markParsed(payloadId, { name: 'Jane' }, { permissions: ['ORDERS:WRITE'] })],
  ])('%s throws 404 when target payload does not exist', async (name, action) => {
    repository.findById.mockResolvedValue({ _id: payloadId, shopId });
    repository.updateStatus.mockResolvedValue(null);
    repository.updateParsedData.mockResolvedValue(null);

    await expect(action()).rejects.toMatchObject({ statusCode: 404 });
  });

  test('createPendingPayload rejects missing order item', async () => {
    orderPublic.findItemById.mockResolvedValue(null);

    await expect(service.createPendingPayload(basePayload, { permissions: ['ORDERS:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('createPendingPayload rejects mismatched order id', async () => {
    orderPublic.findItemById.mockResolvedValue({ _id: orderItemId, orderId: otherShopId, shopId });

    await expect(service.createPendingPayload(basePayload, { permissions: ['ORDERS:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('createPendingPayload rejects mismatched shop id', async () => {
    orderPublic.findItemById.mockResolvedValue({ _id: orderItemId, orderId, shopId: otherShopId });

    await expect(service.createPendingPayload(basePayload, { permissions: ['ORDERS:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('createPendingPayload always computes raw customization hash', async () => {
    orderPublic.findItemById.mockResolvedValue({ _id: orderItemId, orderId, shopId });
    repository.findByOrderItemAndHash.mockResolvedValue(null);
    repository.create.mockImplementation(async (payload) => ({ _id: payloadId, ...payload }));

    const result = await service.createPendingPayload({
      ...basePayload,
      rawCustomizationHash: 'caller-controlled-hash',
    });

    expect(repository.findByOrderItemAndHash.mock.calls[0][1]).not.toBe('caller-controlled-hash');
    expect(repository.create.mock.calls[0][0]).toMatchObject({
      orderItemId,
      orderId,
      shopId,
      status: customizationStatuses.PENDING,
    });
    expect(repository.create.mock.calls[0][0].rawCustomizationHash).not.toBe('caller-controlled-hash');
    expect(result.created).toBe(true);
  });

  test('does not import order public at top-level', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../modules/customization/services/customizationPayload.service.js'), 'utf8');

    expect(source).not.toMatch(/^const\s+orderPublic\s*=\s*require\(['"]\.\.\/\.\.\/order\/public['"]\);/m);
  });
});
