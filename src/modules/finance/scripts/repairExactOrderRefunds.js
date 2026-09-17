const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const RefundRecord = require('../models/refundRecord.model');
const auditPublic = require('../../audit/public');
const orderPublic = require('../../order/public');

function expectedCharge(item = {}) {
  const price = item.price || {};
  const charges = ['itemPriceAmount', 'shippingPriceAmount', 'itemTaxAmount', 'shippingTaxAmount', 'giftWrapPriceAmount', 'giftWrapTaxAmount']
    .reduce((sum, key) => sum + Math.trunc(Number(price[key]) || 0), 0);
  const discounts = ['itemPromotionDiscountAmount', 'shipPromotionDiscountAmount']
    .reduce((sum, key) => sum + Math.trunc(Number(price[key]) || 0), 0);
  return charges - discounts;
}

function distributeRefundsAcrossItems(refunds, items) {
  const remainingByItem = items.map((item) => ({ orderItemId: String(item._id || item.id), amount: expectedCharge(item) }));
  let itemIndex = 0;
  return refunds.map((refund) => {
    let remaining = refund.totalRefundAmount;
    const allocations = [];
    while (remaining > 0 && itemIndex < remainingByItem.length) {
      const item = remainingByItem[itemIndex];
      const amount = Math.min(remaining, item.amount);
      if (amount > 0) allocations.push({ orderItemId: item.orderItemId, amount });
      remaining -= amount;
      item.amount -= amount;
      if (item.amount === 0) itemIndex += 1;
    }
    return remaining === 0 ? allocations : null;
  });
}

async function findCandidates() {
  const refunds = await RefundRecord.find({
    orderItemId: null,
    'allocations.0': { $exists: false },
    externalOrderId: { $type: 'string', $gt: '' },
    totalRefundAmount: { $gt: 0 },
  }).lean();
  const skipped = [];
  const groups = new Map();
  for (const refund of refunds) {
    if (refund.sku || refund.externalItemId) {
      skipped.push({ refundId: String(refund._id), reason: 'ITEM_LEVEL_REFUND' });
      continue;
    }
    const identity = {
      shopId: refund.shopId,
      salesChannelCode: refund.salesChannelCode,
      marketplaceCode: refund.marketplaceCode,
      externalOrderId: refund.externalOrderId,
    };
    const key = JSON.stringify(identity);
    const group = groups.get(key) || { identity, refunds: [] };
    group.refunds.push(refund);
    groups.set(key, group);
  }
  const candidates = [];
  for (const group of groups.values()) {
    const order = await orderPublic.findByExternalIdentity(group.identity);
    if (!order) {
      group.refunds.forEach((refund) => skipped.push({ refundId: String(refund._id), reason: 'ORDER_NOT_FOUND' }));
      continue;
    }
    const items = await orderPublic.listItemsByOrder(order._id || order.id);
    const amount = items.reduce((sum, item) => sum + expectedCharge(item), 0);
    const refundAmount = group.refunds.reduce((sum, refund) => sum + refund.totalRefundAmount, 0);
    if (!items.length || items.some((item) => expectedCharge(item) <= 0)) {
      group.refunds.forEach((refund) => skipped.push({ refundId: String(refund._id), reason: 'INVALID_ITEM_CHARGE' }));
      continue;
    }
    if (group.refunds.some((refund) => items.some((item) => String(item.price?.currency || 'USD').toUpperCase() !== String(refund.currency || 'USD').toUpperCase()))) {
      group.refunds.forEach((refund) => skipped.push({ refundId: String(refund._id), reason: 'CURRENCY_MISMATCH' }));
      continue;
    }
    if (amount !== refundAmount) {
      group.refunds.forEach((refund) => skipped.push({ refundId: String(refund._id), reason: amount > refundAmount ? 'PARTIAL_REFUND' : 'OVER_REFUND' }));
      continue;
    }
    const allocationsByRefund = distributeRefundsAcrossItems(group.refunds, items);
    if (allocationsByRefund.some((allocations) => !allocations)) {
      group.refunds.forEach((refund) => skipped.push({ refundId: String(refund._id), reason: 'ALLOCATION_FAILED' }));
      continue;
    }
    candidates.push({ ...group, order, allocationsByRefund, itemIds: items.map((item) => String(item._id || item.id)) });
  }
  return { candidates, skipped };
}

async function repairExactOrderRefunds({ dryRun = true } = {}) {
  const { candidates, skipped } = await findCandidates();
  const summary = {
    database: mongoose.connection.db?.databaseName || null,
    dryRun,
    candidates: candidates.map(({ refunds, order, itemIds }) => ({
      refundIds: refunds.map((refund) => String(refund._id)), orderId: String(order._id || order.id), externalOrderId: refunds[0].externalOrderId,
      amount: refunds.reduce((sum, refund) => sum + refund.totalRefundAmount, 0), itemCount: itemIds.length,
    })),
    repaired: [],
    skipped: skipped.reduce((counts, entry) => ({ ...counts, [entry.reason]: (counts[entry.reason] || 0) + 1 }), {}),
  };
  if (dryRun) return summary;

  for (const candidate of candidates) {
    const session = await mongoose.startSession();
    try {
      let applied = false;
      await session.withTransaction(async () => {
        for (let index = 0; index < candidate.refunds.length; index += 1) {
          const refund = candidate.refunds[index];
          const result = await RefundRecord.updateOne({
            _id: refund._id,
            orderItemId: null,
            'allocations.0': { $exists: false },
            totalRefundAmount: refund.totalRefundAmount,
          }, {
            $set: { orderId: candidate.order._id || candidate.order.id, allocations: candidate.allocationsByRefund[index] },
          }, { session });
          if (result.modifiedCount !== 1) throw new Error('REFUND_CHANGED_AFTER_DRY_RUN');
        }
        for (const orderItemId of candidate.itemIds) {
          await orderPublic.transitionItemStatus(orderItemId, 'REFUNDED', {
            source: 'FINANCE_ORDER_REFUND_REPAIR',
            allowFinancialRefundConfirmation: true,
            session,
          });
        }
        applied = true;
      });
      if (!applied) {
        summary.skipped.REFUND_CHANGED_AFTER_DRY_RUN = (summary.skipped.REFUND_CHANGED_AFTER_DRY_RUN || 0) + 1;
        continue;
      }
      const orderCase = await orderPublic.ensureOpenOrderCase({
        orderId: String(candidate.order._id || candidate.order.id), caseType: 'REFUND', severity: 'MEDIUM',
        title: 'Repaired full order refund',
        description: 'A historical order-level refund exactly matched all item charges. Fulfillment history remains unchanged.',
      }, { system: true });
      await auditPublic.record({
        actorType: 'SYSTEM', actorSnapshot: {}, action: 'FINANCE_ORDER_REFUND_REPAIRED', entityType: 'REFUND_RECORD',
        entityId: String(candidate.refunds[0]._id), scopeType: 'SHOP', scopeId: String(candidate.refunds[0].shopId), outcome: 'SUCCEEDED',
        source: 'SYSTEM', metadata: { orderId: String(candidate.order._id || candidate.order.id), itemCount: candidate.itemIds.length, refundCount: candidate.refunds.length, orderCaseId: orderCase.id },
        deduplicationKey: `finance-refund-repair:${candidate.refunds.map((refund) => refund._id).join(':')}`,
      });
      summary.repaired.push({ refundIds: candidate.refunds.map((refund) => String(refund._id)), orderId: String(candidate.order._id || candidate.order.id) });
    } catch (error) {
      const reason = error.message === 'REFUND_CHANGED_AFTER_DRY_RUN' ? error.message : 'FAILED';
      summary.skipped[reason] = (summary.skipped[reason] || 0) + 1;
    } finally {
      await session.endSession();
    }
  }
  return summary;
}

async function main() {
  const dryRun = !process.argv.includes('--apply');
  await connectDatabase();
  try {
    process.stdout.write(`${JSON.stringify(await repairExactOrderRefunds({ dryRun }), null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { findCandidates, repairExactOrderRefunds };
