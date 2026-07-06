const OrderItem = require('../../../modules/order/models/orderItem.model');

function hasIndex(model, expectedFields) {
  return model.schema.indexes()
    .some(([fields]) => JSON.stringify(fields) === JSON.stringify(expectedFields));
}

describe('OrderItem model indexes', () => {
  test('supports fetching items for workbench order pages', () => {
    expect(hasIndex(OrderItem, { orderId: 1, createdAt: 1, _id: 1 })).toBe(true);
  });
});
