const Order = require('../../../src/modules/order/models/order.model');

function hasIndex(model, expectedFields) {
  return model.schema.indexes()
    .some(([fields]) => JSON.stringify(fields) === JSON.stringify(expectedFields));
}

describe('Order model indexes', () => {
  test('supports workbench default ordering', () => {
    expect(hasIndex(Order, { orderedAt: -1, _id: -1 })).toBe(true);
  });
});
