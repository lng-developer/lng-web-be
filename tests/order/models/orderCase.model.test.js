const OrderCase = require('../../../src/modules/order/models/orderCase.model');

describe('OrderCase model indexes', () => {
  test('indexes latest open-case lookup by order and recency', () => {
    expect(OrderCase.schema.indexes().map(([fields]) => fields)).toContainEqual({
      orderId: 1,
      status: 1,
      createdAt: -1,
      _id: -1,
    });
  });
});
