const { toOrderFinanceSummaryDto } = require('../../src/modules/finance/dtos/financeSnapshot.dto');
test('never adds different currencies in an order summary', () => {
  const snapshot = { customerPaidAmount: 1000, baseCostAmount: 100, totalCostAmount: 200, grossProfitAmount: 800 };
  const result = toOrderFinanceSummaryDto('order', [{ ...snapshot, currency: 'USD' }, { ...snapshot, currency: 'EUR' }]);
  expect(result).toMatchObject({ currency: null, customerPaidAmount: null, grossProfitAmount: null });
  expect(result.summaryByCurrency).toHaveLength(2);
  expect(result.summaryByCurrency.map(row => row.grossProfitAmount)).toEqual([800, 800]);
});

test('canonical summary preserves cancellation revenue and unknown profit', () => {
  const source = { calculationVersion: 2, currency: 'USD', customerPaidAmount: 1000,
    recognizedNetRevenueAmount: 0, feeAmount: 50, effectiveFulfillmentCostAmount: 200,
    costComponents: [{ code: 'VENDOR_BASE', amount: 200 }], profitBeforeAdsAmount: -250 };
  expect(toOrderFinanceSummaryDto('order', [source])).toMatchObject({
    recognizedNetRevenueAmount: 0, revenueAdjustmentAmount: 1000, marketplaceFeeAmount: 50,
    baseCostAmount: 200, totalCostAmount: 200, grossProfitAmount: -250,
  });
  expect(toOrderFinanceSummaryDto('order', [{ ...source, profitBeforeAdsAmount: null }]).grossProfitAmount).toBeNull();
});
