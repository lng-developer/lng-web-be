jest.mock('../../../src/modules/order/models/orderCase.model', () => ({
  aggregate: jest.fn(),
}));

const OrderCase = require('../../../src/modules/order/models/orderCase.model');
const repository = require('../../../src/modules/order/repositories/orderCase.repository');

describe('orderCase repository', () => {
  test('gets one newest open case per requested order in Mongo', async () => {
    const orderIds = ['660000000000000000000001', '660000000000000000000002'];
    const rows = [{ _id: '660000000000000000000101', orderId: orderIds[0], status: 'OPEN' }];
    OrderCase.aggregate.mockResolvedValue(rows);

    await expect(repository.listLatestOpenByOrderIds(orderIds)).resolves.toEqual(rows);
    expect(OrderCase.aggregate).toHaveBeenCalledWith([
      { $match: { orderId: { $in: orderIds }, status: 'OPEN' } },
      { $sort: { orderId: 1, createdAt: -1, _id: -1 } },
      { $group: { _id: '$orderId', case: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$case' } },
    ]);
  });
});
