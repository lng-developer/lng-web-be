const AdsSpendDaily = require('../models/adsSpendDaily.model');
const FinanceImportBatch = require('../models/financeImportBatch.model');
const mongoose = require('mongoose');
const MarketplaceFeeLine = require('../models/marketplaceFeeLine.model');
const MarketplaceSettlement = require('../models/marketplaceSettlement.model');
const MarketplaceSettlementLedgerLine = require('../models/marketplaceSettlementLedgerLine.model');
const RefundRecord = require('../models/refundRecord.model');

function cleanNulls(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function upsert(model, filter, payload) {
  return model.findOneAndUpdate(
    filter,
    { $set: cleanNulls(payload) },
    {
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  ).lean();
}

async function createImportBatch(payload) {
  return FinanceImportBatch.create(payload);
}

async function findImportBatchById(batchId) {
  return FinanceImportBatch.findById(batchId).lean();
}

async function completeImportBatch(batchId, summary) {
  return FinanceImportBatch.findByIdAndUpdate(batchId, {
    $set: {
      status: summary.status,
      processedRows: summary.processedRows,
      validRows: summary.validRows,
      skippedRows: summary.skippedRows,
      unlinkedRows: summary.unlinkedRows,
      upserted: summary.upserted,
      errorCount: summary.errors.length,
      errors: summary.errors,
      finishedAt: new Date(),
    },
  }, { returnDocument: 'after', runValidators: true }).lean();
}

async function upsertSettlement(payload) {
  return upsert(MarketplaceSettlement, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    settlementId: payload.settlementId,
  }, payload);
}

async function upsertLedgerLine(payload) {
  return upsert(MarketplaceSettlementLedgerLine, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    sourceRef: payload.sourceRef,
    'rawReference.importKey': payload.rawReference?.importKey,
  }, payload);
}

async function upsertFeeLine(payload) {
  return upsert(MarketplaceFeeLine, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    sourceRef: payload.sourceRef,
    'rawReference.importKey': payload.rawReference?.importKey,
  }, payload);
}

async function upsertRefundRecord(payload) {
  return upsert(RefundRecord, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    externalRefundId: payload.externalRefundId,
  }, payload);
}

async function upsertAdsSpend(payload) {
  return upsert(AdsSpendDaily, {
    shopId: payload.shopId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
    reportDate: payload.reportDate,
    campaignName: payload.campaignName,
  }, payload);
}

async function sumFeesByOrderItem(orderItemId) {
  const _id = new mongoose.Types.ObjectId(String(orderItemId));
  const result = await MarketplaceFeeLine.aggregate([
    { $match: { orderItemId: _id } },
    { $group: { _id: null, total: { $sum: '$totalFeeAmount' } } },
  ]);
  return result.length ? result[0].total : null;
}

async function sumRefundsByOrderItem(orderItemId) {
  const _id = new mongoose.Types.ObjectId(String(orderItemId));
  const result = await RefundRecord.aggregate([
    { $match: { orderItemId: _id } },
    { $group: { _id: null, total: { $sum: '$totalRefundAmount' } } },
  ]);
  return result.length ? result[0].total : null;
}

module.exports = {
  completeImportBatch,
  createImportBatch,
  findImportBatchById,
  sumFeesByOrderItem,
  sumRefundsByOrderItem,
  upsertAdsSpend,
  upsertFeeLine,
  upsertLedgerLine,
  upsertRefundRecord,
  upsertSettlement,
};
