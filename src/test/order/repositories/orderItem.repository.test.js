jest.mock('../../../modules/order/models/orderItem.model', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

const OrderItem = require('../../../modules/order/models/orderItem.model');
const repository = require('../../../modules/order/repositories/orderItem.repository');

const identity = {
  shopId: '660000000000000000000201',
  salesChannelCode: 'AMAZON',
  marketplaceCode: 'AMAZON_US',
  externalOrderId: '114-1',
  externalItemId: 'ITEM-1',
  sku: 'SKU-1',
};

function leanResult(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function listResult(value) {
  const lean = jest.fn().mockResolvedValue(value);
  return { limit: jest.fn().mockReturnValue({ lean }) };
}

describe('orderItem.repository findByFinanceIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('prefers an external item match over a mismatched SKU', async () => {
    const item = { _id: '660000000000000000000401', externalItemId: identity.externalItemId, sku: 'SKU-ACTUAL' };
    OrderItem.findOne.mockReturnValue(leanResult(item));

    await expect(repository.findByFinanceIdentity({ ...identity, sku: 'SKU-OTHER' })).resolves.toEqual(item);
    expect(OrderItem.findOne).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: identity.externalOrderId,
      externalItemId: identity.externalItemId,
    }));
    expect(OrderItem.findOne.mock.calls[0][0]).not.toHaveProperty('sku');
  });

  test('falls back to a unique SKU match when the external item code differs', async () => {
    const item = { _id: '660000000000000000000401', sku: identity.sku };
    OrderItem.findOne.mockReturnValue(leanResult(null));
    OrderItem.find.mockReturnValue(listResult([item]));

    await expect(repository.findByFinanceIdentity({ ...identity, externalItemId: 'WRONG-ITEM' })).resolves.toEqual(item);
    expect(OrderItem.find).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: identity.externalOrderId,
      sku: identity.sku,
    }));
  });

  test('does not link an ambiguous SKU match', async () => {
    OrderItem.findOne.mockReturnValue(leanResult(null));
    OrderItem.find.mockReturnValue(listResult([
      { _id: '660000000000000000000401', sku: identity.sku },
      { _id: '660000000000000000000402', sku: identity.sku },
    ]));

    await expect(repository.findByFinanceIdentity({ ...identity, externalItemId: 'WRONG-ITEM' })).resolves.toBeNull();
    expect(OrderItem.find).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: identity.externalOrderId,
      sku: identity.sku,
    }));
  });
});
