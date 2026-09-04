const OrderWorkbenchProjection = require('../../../src/modules/order/models/orderWorkbenchProjection.model');

function hasIndex(model, expectedFields) {
  return model.schema.indexes()
    .some(([fields]) => JSON.stringify(fields) === JSON.stringify(expectedFields));
}

describe('OrderWorkbenchProjection model indexes', () => {
  test('supports the default and shop-scoped workbench orderings', () => {
    expect(hasIndex(OrderWorkbenchProjection, { orderId: 1 })).toBe(true);
    expect(hasIndex(OrderWorkbenchProjection, { orderedAt: -1, _id: -1 })).toBe(true);
    expect(hasIndex(OrderWorkbenchProjection, { shopId: 1, orderedAt: -1, _id: -1 })).toBe(true);
    expect(hasIndex(OrderWorkbenchProjection, { shopId: 1, status: 1, orderedAt: -1, _id: -1 })).toBe(true);
  });
});
