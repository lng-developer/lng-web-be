const { allocateVendorOrderCost } = require('../../../src/modules/vendorSubmission/services/vendorCostAllocation.service');
const items = ['c', 'a', 'b'].map(orderItemId => ({ orderItemId, currency: 'USD', estimatedAmount: 100, quantity: 1 }));
const run = (totalAmount, changes = {}) => allocateVendorOrderCost({ vendorOrderId: 'vendor-1', currency: 'USD', totalAmount, items, ...changes });
test.each([[3564, [1188, 1188, 1188]], [100, [34, 33, 33]], [-100, [-34, -33, -33]], [0, [0, 0, 0]]])('allocates %i cents exactly and deterministically', (total, expected) => {
  const result = run(total);
  expect(result.allocations.map(row => row.totalAmount)).toEqual(expected);
  expect(result.allocations.map(row => row.orderItemId)).toEqual(['a', 'b', 'c']);
  expect(run(total)).toEqual(result);
});
test('uses relative estimates, then quantities if estimates missing', () => {
  expect(run(100, { items: [{ ...items[0], estimatedAmount: 0 }, items[1]] }).allocations.map(x => x.totalAmount)).toEqual([50, 50]);
  expect(run(100, { items: [{ ...items[0], estimatedAmount: 300 }, items[1]] }).allocations.map(x => x.totalAmount)).toEqual([25, 75]);
  expect(run(100, { items: [{ ...items[0], estimatedAmount: null, quantity: 3 }, items[1]] }).allocations.map(x => x.totalAmount)).toEqual([25, 75]);
});
test('rejects incomplete identities, invalid money and mixed currency', () => {
  expect(() => run(1.5)).toThrow();
  expect(() => run(100, { items: [] })).toThrow();
  expect(() => run(100, { items: [items[0], items[0]] })).toThrow();
  expect(() => run(100, { items: [{ ...items[0], currency: 'EUR' }] })).toThrow();
});
