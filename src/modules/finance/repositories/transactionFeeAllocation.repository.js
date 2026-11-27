const mongoose = require('mongoose');
const Ledger = require('../models/marketplaceSettlementLedgerLine.model');
const Fee = require('../models/marketplaceFeeLine.model');

function scope(row) {
  return { shopId: row.shopId, salesChannelCode: row.salesChannelCode, marketplaceCode: row.marketplaceCode };
}

function listOrderTransactions({ afterId, beforeId, shopId, limit = 200 }) {
  return Ledger.find({
    ledgerCategory: 'TRANSACTION', orderItemId: null, sku: null, externalItemId: null,
    externalOrderId: { $nin: [null, ''] },
    _id: { $lte: beforeId, ...(afterId ? { $gt: afterId } : {}) },
    ...(shopId ? { shopId } : {}),
  }).sort({ _id: 1 }).limit(limit).lean();
}

function listTransactionFees(row, session) {
  const prefix = row.rawReference?.dedupKey;
  const importKey = row.rawReference?.importKey;
  if (!prefix && !importKey) return Promise.resolve([]);
  const types = ['SELLING_FEES', 'FBA_FEES', 'OTHER_TRANSACTION_FEES'];
  return Fee.find({ ...scope(row), externalOrderId: row.externalOrderId,
    orderItemId: null, sku: null, externalItemId: null,
    ...(prefix ? { 'rawReference.dedupKey': { $in: types.map(type => `${prefix}:${type}`) } }
      : { sourceRef: row.sourceRef, 'rawReference.importKey': { $in: types.map(type => `${importKey}:${type}`) } }),
  }, null, { session }).lean();
}

async function applyAllocation(row, orderId, fees, session) {
  const ledger = await Ledger.updateOne({ _id: row._id, ...scope(row), orderItemId: null,
    externalOrderId: row.externalOrderId, sku: null, externalItemId: null, amount: row.amount, currency: row.currency,
    orderId: row.orderId ?? null,
  }, { $set: { orderId } }, { session });
  if (!ledger.matchedCount) throw new Error('Transaction changed during fee allocation; rerun the backfill');
  for (const fee of fees) {
    const result = await Fee.updateOne({ _id: fee._id, ...scope(row), orderItemId: null,
      totalFeeAmount: fee.totalFeeAmount, currency: fee.currency, externalOrderId: row.externalOrderId, sku: null, externalItemId: null,
      allocations: fee.previousAllocations ?? { $exists: false },
    }, { $set: { orderId, allocations: fee.allocations, allocationMethod: fee.allocationMethod } }, { session, runValidators: true });
    if (!result.matchedCount) throw new Error('Fee changed during allocation; rerun the backfill');
  }
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => work(session)); }
  finally { await session.endSession(); }
}

module.exports = { listOrderTransactions, listTransactionFees, applyAllocation, withTransaction };
