const crypto = require('crypto');
const orderPublic = require('../../order/public');

function allocateTransactionFee(amount, items, currency) {
  if (!Number.isSafeInteger(amount)) throw new Error('Fee must be safe integer minor units');
  if (!items.length || items.some(item => !item.price?.currency || item.price.currency !== currency)) return null;
  const sorted = [...items].sort((a, b) => String(a._id || a.id).localeCompare(String(b._id || b.id)));
  const ids = sorted.map(item => String(item._id || item.id || ''));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return null;
  let weights = sorted.map(item => {
    const price = item.price?.itemPriceAmount;
    const discount = item.price?.itemPromotionDiscountAmount ?? 0;
    return Number.isSafeInteger(price) && Number.isSafeInteger(discount) ? Math.max(0, price - discount) : null;
  });
  let allocationMethod = 'ITEM_VALUE';
  if (weights.some(value => value === null) || !weights.some(value => value > 0)) {
    allocationMethod = 'MARKETPLACE_QUANTITY';
    weights = sorted.map(item => item.marketplaceQuantity ?? (item.quantityOverride == null ? item.quantity : null));
    if (weights.some(value => !Number.isSafeInteger(value) || value <= 0)) return null;
  }
  // Largest remainders avoid floating-point money and give deterministic cent rounding.
  const totalWeight = weights.reduce((sum, value) => sum + BigInt(value), 0n);
  const absolute = BigInt(Math.abs(amount));
  const parts = weights.map((weight, index) => ({ index, amount: absolute * BigInt(weight) / totalWeight, remainder: absolute * BigInt(weight) % totalWeight }));
  let remainder = absolute - parts.reduce((sum, part) => sum + part.amount, 0n);
  for (const part of [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (remainder === 0n) break;
    part.amount += 1n;
    remainder -= 1n;
  }
  return { allocationMethod, allocations: parts.map(part => ({ orderItemId: ids[part.index], amount: Number(part.amount) * (amount < 0 ? -1 : 1) })) };
}

async function resolveTransactionOrder(row, context = row) {
  if (!row.externalOrderId || row.sku || row.externalItemId) return null;
  const order = await orderPublic.findByExternalIdentity({ shopId: context.shopId, salesChannelCode: context.salesChannelCode, marketplaceCode: context.marketplaceCode, externalOrderId: row.externalOrderId });
  if (!order) return null;
  const orderId = order._id || order.id;
  const items = await orderPublic.listItemsByOrder(orderId);
  return { orderId, items };
}

async function backfillTransactionFees({ beforeId, shopId, dryRun = true, onProgress = async () => {} }) {
  const repository = require('../repositories/transactionFeeAllocation.repository');
  const snapshotService = require('./financeSnapshot.service');
  const auditPublic = require('../../audit/public');
  const result = { dryRun, checked: 0, linked: 0, feeRows: 0, allocatedItems: 0, unresolved: [], failed: [], recalculatedOrders: 0 };
  const orderIds = new Set();
  const itemIds = new Set();
  let afterId;
  while (true) {
    const rows = await repository.listOrderTransactions({ afterId, beforeId, shopId });
    if (!rows.length) break;
    for (const row of rows) {
      result.checked += 1;
      afterId = row._id;
      try {
        const order = await resolveTransactionOrder(row);
        if (!order) { result.unresolved.push({ transactionId: String(row._id), reason: 'ORDER_NOT_FOUND' }); continue; }
        const fees = await repository.listTransactionFees(row);
        const planned = fees.map(fee => ({ ...fee, previousAllocations: fee.allocations, allocationMethod: null, allocations: [], ...allocateTransactionFee(fee.totalFeeAmount, order.items, fee.currency) }));
        if (planned.some(fee => !fee.allocationMethod || !fee.allocations?.length)) {
          result.unresolved.push({ transactionId: String(row._id), reason: 'INVALID_ALLOCATION_WEIGHTS_OR_CURRENCY' }); continue;
        }
        if (!dryRun) {
          await repository.withTransaction(async (session) => {
            await repository.applyAllocation(row, order.orderId, planned, session);
            await auditPublic.record({ actorType: 'SYSTEM', action: 'FINANCE_TRANSACTION_FEES_ALLOCATED',
              entityType: 'ORDER', entityId: String(order.orderId), scopeType: 'SHOP', scopeId: String(row.shopId),
              outcome: 'SUCCEEDED', source: 'SYSTEM', deduplicationKey: `transaction-fee-allocation:v1:${row._id}:${crypto.createHash('sha256').update(JSON.stringify(planned.map(fee => [String(fee._id), fee.allocationMethod, fee.allocations]))).digest('hex')}`, metadata: { transactionId: String(row._id), feeRows: planned.length },
            }, { session });
          });
        }
        result.linked += 1;
        result.feeRows += planned.length;
        for (const fee of planned) for (const entry of fee.allocations) itemIds.add(String(entry.orderItemId));
        if (planned.length) orderIds.add(String(order.orderId));
      } catch (error) { result.failed.push({ transactionId: String(row._id), reason: error.message }); }
    }
    await onProgress({ checked: result.checked, linked: result.linked, feeRows: result.feeRows });
  }
  result.allocatedItems = itemIds.size;
  result.affectedOrders = orderIds.size;
  if (!dryRun) {
    for (const orderId of orderIds) {
      try {
        await snapshotService.recalculateOrder(orderId, { system: true });
        result.recalculatedOrders += 1;
      } catch (error) { result.failed.push({ orderId, reason: error.message }); }
      await onProgress({ recalculatedOrders: result.recalculatedOrders, affectedOrders: orderIds.size });
    }
  }
  return result;
}

module.exports = { allocateTransactionFee, resolveTransactionOrder, backfillTransactionFees };
