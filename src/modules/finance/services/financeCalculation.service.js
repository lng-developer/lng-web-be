const CALCULATION_VERSION = 2;

function money(value, fallback = 0) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value)) throw new TypeError('Financial amounts must be safe integer minor units');
  return value;
}

/** Inputs are normalized gross line totals in minor units; discounts and refunds are separate. */
function calculateFinancials({ revenue = {}, fee = {}, estimate, actualVendorCost, internalCosts = [], financialStatus } = {}) {
  const customerPaidAmount = money(revenue.customerPaidAmount);
  const refundAmount = money(revenue.refundAmount);
  const discountAmount = financialStatus === 'CANCELLED' ? 0 : money(revenue.discountAmount);
  const recognizedNetRevenueAmount = financialStatus === 'CANCELLED' ? 0
    : customerPaidAmount - refundAmount - discountAmount;
  const estimatedFulfillmentCostAmount = money(estimate?.totalAmount, null);
  const actualAmount = money(actualVendorCost?.totalAmount, null);
  const internal = internalCosts.map(line => ({ ...line, amount: money(line.amount) }));
  const estimateMismatch = estimate?.currency && revenue.currency && estimate.currency !== revenue.currency;
  const currencyMismatch = revenue.currency && ((actualAmount !== null && actualVendorCost?.currency && actualVendorCost.currency !== revenue.currency)
    || (actualAmount === null && estimateMismatch)
    || (actualAmount !== null && internal.some(line => line.amount !== 0 && line.currency && line.currency !== revenue.currency)));
  const hasActual = actualAmount !== null && !currencyMismatch;
  const effectiveFulfillmentCostAmount = currencyMismatch ? null : hasActual
    ? actualAmount + internal.reduce((sum, line) => sum + line.amount, 0) : estimatedFulfillmentCostAmount;
  const costSource = effectiveFulfillmentCostAmount === null ? 'MISSING' : hasActual ? 'ACTUAL' : 'ESTIMATED';
  const costComponents = hasActual ? [
    { code: 'VENDOR_BASE', amount: money(actualVendorCost.baseCostAmount) },
    { code: 'VENDOR_SHIPPING', amount: money(actualVendorCost.shippingAmount) },
    { code: 'VENDOR_TAX', amount: money(actualVendorCost.taxAmount) },
    { code: 'VENDOR_OTHER', amount: actualAmount - money(actualVendorCost.baseCostAmount)
      - money(actualVendorCost.shippingAmount) - money(actualVendorCost.taxAmount) },
    ...internal,
  ] : effectiveFulfillmentCostAmount === null ? [] : [{ code: 'ESTIMATE', amount: effectiveFulfillmentCostAmount }];
  const marketplaceFeeAmount = money(fee.amount);
  const profitBeforeAdsAmount = effectiveFulfillmentCostAmount === null ? null
    : recognizedNetRevenueAmount - marketplaceFeeAmount - effectiveFulfillmentCostAmount;
  if (profitBeforeAdsAmount !== null) money(profitBeforeAdsAmount);
  return {
    calculationVersion: CALCULATION_VERSION,
    estimatedFulfillmentCostAmount: estimateMismatch ? null : estimatedFulfillmentCostAmount,
    effectiveFulfillmentCostAmount,
    costVarianceAmount: estimateMismatch || effectiveFulfillmentCostAmount === null || estimatedFulfillmentCostAmount === null ? null : effectiveFulfillmentCostAmount - estimatedFulfillmentCostAmount,
    recognizedNetRevenueAmount,
    profitBeforeAdsAmount,
    costSource,
    costStatus: costSource === 'MISSING' ? 'MISSING' : 'PRESENT',
    costComponents,
    profitStatus: costSource === 'MISSING' ? 'INCOMPLETE_COST'
      : fee.confidence === 'ACTUAL' && !actualVendorCost?.allocated && (hasActual || financialStatus === 'CANCELLED' && effectiveFulfillmentCostAmount === 0)
        ? 'ACTUAL' : 'ESTIMATED',
    missingCostReason: currencyMismatch ? 'COST_CURRENCY_MISMATCH' : costSource === 'MISSING' ? 'COST_ESTIMATE_NOT_AVAILABLE' : null,
  };
}

function calculateSnapshotFinancials(snapshot = {}) {
  return calculateFinancials({
    revenue: snapshot,
    financialStatus: snapshot.financialStatus,
    fee: { amount: snapshot.feeAmount, confidence: snapshot.feeConfidence },
    estimate: { totalAmount: snapshot.costStatus === 'MISSING' ? null : snapshot.totalCostAmount, currency: snapshot.estimatedCostCurrency },
    actualVendorCost: {
      totalAmount: snapshot.actualVendorTotalAmount,
      baseCostAmount: snapshot.actualVendorBaseCostAmount,
      shippingAmount: snapshot.actualVendorShippingAmount,
      taxAmount: snapshot.actualVendorTaxAmount,
      currency: snapshot.actualVendorCurrency,
      allocated: (snapshot.actualVendorAllocation?.orderItemIds?.length || 0) > 1,
    },
    // Only explicit internal charges are additive; rate-card vendor components are replaced.
    internalCosts: (snapshot.costLines || []).filter(line => line.code === 'LNG_FULFILLMENT_FEE'),
  });
}

function readSnapshotFinancials(snapshot = {}) {
  if (snapshot.calculationVersion === CALCULATION_VERSION) {
    return Object.fromEntries(['calculationVersion', 'estimatedFulfillmentCostAmount', 'effectiveFulfillmentCostAmount',
      'recognizedNetRevenueAmount', 'profitBeforeAdsAmount', 'costSource', 'costComponents', 'costVarianceAmount', 'profitStatus']
      .map(key => [key, snapshot[key] ?? null]));
  }
  // Legacy snapshots keep their persisted profit until the explicit versioned rebuild.
  return {
    calculationVersion: 1,
    estimatedFulfillmentCostAmount: snapshot.totalCostAmount ?? null,
    effectiveFulfillmentCostAmount: snapshot.actualVendorTotalAmount ?? snapshot.totalCostAmount ?? null,
    recognizedNetRevenueAmount: (snapshot.netRevenueAmount ?? Math.max((snapshot.customerPaidAmount || 0) - (snapshot.refundAmount || 0), 0)) - (snapshot.discountAmount || 0),
    profitBeforeAdsAmount: snapshot.grossProfitAmount ?? null,
    costSource: snapshot.actualVendorTotalAmount != null ? 'ACTUAL' : snapshot.totalCostAmount != null ? 'ESTIMATED' : 'MISSING',
    costComponents: [],
    profitStatus: snapshot.profitStatus || 'ESTIMATED',
  };
}

function vendorCostFields(vendorCost) {
  return {
    actualVendorBaseCostAmount: vendorCost.vendorBaseCostAmount ?? null,
    actualVendorShippingAmount: vendorCost.shippingAmount ?? null,
    actualVendorTaxAmount: vendorCost.taxAmount ?? null,
    actualVendorTotalAmount: vendorCost.totalAmount ?? null,
    actualVendorCurrency: vendorCost.currency || null,
    actualVendorSource: vendorCost.source || null,
    actualVendorCapturedAt: vendorCost.capturedAt || null,
    actualVendorAllocation: vendorCost.allocation || null,
  };
}

module.exports = { CALCULATION_VERSION, calculateFinancials, calculateSnapshotFinancials, readSnapshotFinancials, vendorCostFields };
