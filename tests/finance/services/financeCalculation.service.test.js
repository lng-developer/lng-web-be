const { calculateFinancials } = require('../../../src/modules/finance/services/financeCalculation.service');

const input = (overrides = {}) => ({
  revenue: { customerPaidAmount: 9240, netRevenueAmount: 9240, currency: 'USD' },
  fee: { amount: 677, confidence: 'ACTUAL' },
  estimate: { totalAmount: 3814 },
  actualVendorCost: { totalAmount: 3564, baseCostAmount: 2559, shippingAmount: 1005, currency: 'USD' },
  ...overrides,
});

describe('canonical financial calculation', () => {
  test('withholds foreign estimate and internal fee profit and variance', () => {
    const revenue = { customerPaidAmount: 2000, currency: 'EUR' };
    expect(calculateFinancials({ revenue, estimate: { totalAmount: 1500, currency: 'USD' } }))
      .toMatchObject({ effectiveFulfillmentCostAmount: null, profitBeforeAdsAmount: null, costVarianceAmount: null });
    expect(calculateFinancials({ revenue, actualVendorCost: { totalAmount: 1000, currency: 'EUR' },
      internalCosts: [{ code: 'LNG_FULFILLMENT_FEE', amount: 100, currency: 'USD' }] }).profitBeforeAdsAmount).toBeNull();
  });
  test('one vendor total yields the same cost and profit in the waterfall', () => {
    const result = calculateFinancials(input());
    expect(result.effectiveFulfillmentCostAmount).toBe(3564);
    expect(result.profitBeforeAdsAmount).toBe(4999);
    expect(result.costComponents.reduce((sum, row) => sum + row.amount, 0)).toBe(3564);
    expect(result.profitStatus).toBe('ACTUAL');
  });
  test('missing cost is not zero while actual zero is known', () => {
    expect(calculateFinancials(input({ estimate: null, actualVendorCost: null })).profitBeforeAdsAmount).toBeNull();
    expect(calculateFinancials(input({ actualVendorCost: { totalAmount: 0, currency: 'USD' } })).profitBeforeAdsAmount).toBe(8563);
  });
  test.each(['ESTIMATED', 'ALLOCATED'])('%s fees do not imply actual item profit', (confidence) => {
    expect(calculateFinancials(input({ fee: { amount: 677, confidence } })).profitStatus).toBe('ESTIMATED');
  });
  test('refund and discount are deducted once, and fee credits remain signed', () => {
    const result = calculateFinancials(input({ revenue: { customerPaidAmount: 9240, netRevenueAmount: 8240, refundAmount: 1000, discountAmount: 200, currency: 'USD' }, fee: { amount: -50, confidence: 'ACTUAL' } }));
    expect(result.recognizedNetRevenueAmount).toBe(8040);
    expect(result.profitBeforeAdsAmount).toBe(4526);
  });
  test('cancellation retains incurred cost and does not charge an unearned discount', () => {
    const result = calculateFinancials(input({ financialStatus: 'CANCELLED', revenue: { customerPaidAmount: 9240, discountAmount: 100, currency: 'USD' } }));
    expect(result.recognizedNetRevenueAmount).toBe(0);
    expect(result.profitBeforeAdsAmount).toBe(-4241);
  });
  test('internal costs stay separate from vendor shipping', () => {
    const result = calculateFinancials(input({ internalCosts: [{ code: 'LNG_FULFILLMENT_FEE', amount: 100 }] }));
    expect(result.effectiveFulfillmentCostAmount).toBe(3664);
    expect(result.costComponents.find(row => row.code === 'VENDOR_SHIPPING').amount).toBe(1005);
    expect(result.profitBeforeAdsAmount).toBe(4899);
  });
  test('foreign currency actual costs cannot be silently used or replaced by estimates', () => {
    expect(calculateFinancials(input({ actualVendorCost: { totalAmount: 3564, currency: 'EUR' } })).profitBeforeAdsAmount).toBeNull();
  });
  test('invalid fractional amounts are rejected', () => {
    expect(() => calculateFinancials(input({ fee: { amount: 1.5 } }))).toThrow();
  });
  test('does not hide an over-refund behind the legacy net revenue floor', () => {
    const result = calculateFinancials(input({ revenue: { customerPaidAmount: 1000, netRevenueAmount: 0, refundAmount: 1200 }, estimate: null, actualVendorCost: { totalAmount: 0 }, fee: { amount: 0, confidence: 'ACTUAL' } }));
    expect(result.profitBeforeAdsAmount).toBe(-200);
  });
});
