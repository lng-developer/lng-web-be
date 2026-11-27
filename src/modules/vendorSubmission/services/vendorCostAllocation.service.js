function allocateVendorOrderCost({ vendorOrderId, currency, totalAmount, items, sourceVersion = null }) {
  if (!vendorOrderId || !currency || !Number.isSafeInteger(totalAmount) || !items?.length) throw new Error('Incomplete vendor cost evidence');
  const sorted = [...items].sort((a, b) => String(a.orderItemId).localeCompare(String(b.orderItemId)));
  const ids = sorted.map(item => String(item.orderItemId || ''));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || sorted.some(item => item.currency !== currency)) throw new Error('Ambiguous vendor cost membership or currency');
  let weights = sorted.map(item => item.estimatedAmount);
  let basis = 'ESTIMATED_COST';
  if (weights.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    basis = 'FULFILLMENT_QUANTITY';
    weights = sorted.map(item => item.quantity);
    if (weights.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error('Missing vendor allocation weights');
  }
  const weightTotal = weights.reduce((sum, value) => sum + BigInt(value), 0n);
  const absolute = BigInt(Math.abs(totalAmount));
  const shares = weights.map((weight, index) => ({ index, amount: absolute * BigInt(weight) / weightTotal, remainder: absolute * BigInt(weight) % weightTotal }));
  let remaining = absolute - shares.reduce((sum, share) => sum + share.amount, 0n);
  for (const share of [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (!remaining) break;
    share.amount += 1n;
    remaining -= 1n;
  }
  return {
    allocations: shares.map(share => ({ orderItemId: ids[share.index], totalAmount: Number(share.amount) * (totalAmount < 0 ? -1 : 1) })),
    provenance: { vendorOrderId, currency, totalAmount, basis, sourceVersion, orderItemIds: ids },
  };
}

module.exports = { allocateVendorOrderCost };
