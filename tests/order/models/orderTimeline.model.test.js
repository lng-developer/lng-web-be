const OrderTimeline = require('../../../src/modules/order/models/orderTimeline.model');

describe('OrderTimeline model', () => {
  test('indexes order timeline reads with their deterministic sort', () => {
    expect(OrderTimeline.schema.indexes()).toContainEqual([
      { orderId: 1, createdAt: -1, _id: -1 },
      {},
    ]);
  });
});
