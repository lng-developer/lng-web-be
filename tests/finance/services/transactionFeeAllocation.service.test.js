const { allocateTransactionFee } = require('../../../src/modules/finance/services/transactionFeeAllocation.service');
const item = (id, amount, quantity = 1) => ({ _id: id, price: { itemPriceAmount: amount, currency: 'USD' }, marketplaceQuantity: quantity });
describe('transaction fee allocation', () => {
  test('allocates signed cents by line value and preserves exact total', () => {
    expect(allocateTransactionFee(501, [item('b', 3000), item('a', 2000)], 'USD')).toEqual({
      allocationMethod: 'ITEM_VALUE', allocations: [{ orderItemId: 'a', amount: 200 }, { orderItemId: 'b', amount: 301 }],
    });
    expect(allocateTransactionFee(-501, [item('a', 2000), item('b', 3000)], 'USD').allocations.map(x => x.amount)).toEqual([-200, -301]);
  });
  test('falls back for incomplete prices using marketplace quantity, not production quantity', () => {
    const items = [item('a', null, 1), { ...item('b', 2000, 2), quantity: 20 }];
    expect(allocateTransactionFee(100, items, 'USD')).toEqual({ allocationMethod: 'MARKETPLACE_QUANTITY', allocations: [{ orderItemId: 'a', amount: 33 }, { orderItemId: 'b', amount: 67 }] });
  });
  test('does not guess across currencies, invalid weights or duplicate items', () => {
    expect(allocateTransactionFee(100, [item('a', 100)], 'EUR')).toBeNull();
    expect(allocateTransactionFee(100, [item('a', null, 0)], 'USD')).toBeNull();
    expect(allocateTransactionFee(100, [item('a', 100), item('a', 100)], 'USD')).toBeNull();
    expect(() => allocateTransactionFee(1.2, [item('a', 100)], 'USD')).toThrow();
  });
  test('rounding is deterministic independent of item order including tiny fees', () => {
    const items = [item('c', 100), item('b', 100), item('a', 100)];
    const result = allocateTransactionFee(1, items, 'USD');
    expect(result.allocations.map(x => x.amount)).toEqual([1, 0, 0]);
    expect(allocateTransactionFee(1, [...items].reverse(), 'USD')).toEqual(result);
  });
});
