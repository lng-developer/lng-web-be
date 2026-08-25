const AdsShopMapping = require('../models/adsShopMapping.model');

function findActiveByExternalIds({ advertiserAccountId, salesChannelCode, marketplaceCode, externalIds }) {
  return AdsShopMapping.find({
    advertiserAccountId,
    salesChannelCode,
    marketplaceCode,
    active: true,
    externalId: { $in: externalIds },
  }).lean();
}

function upsert(payload) {
  return AdsShopMapping.findOneAndUpdate({
    advertiserAccountId: payload.advertiserAccountId,
    matchType: payload.matchType,
    externalId: payload.externalId,
    salesChannelCode: payload.salesChannelCode,
    marketplaceCode: payload.marketplaceCode,
  }, payload, { new: true, upsert: true, runValidators: true }).lean();
}

function list(query = {}) {
  const filter = {};
  if (query.advertiserAccountId) filter.advertiserAccountId = query.advertiserAccountId;
  if (query.shopId) filter.shopId = query.shopId;
  if (query.matchType) filter.matchType = query.matchType;
  if (query.active !== undefined) filter.active = query.active;
  return AdsShopMapping.find(filter).sort({ advertiserAccountId: 1, matchType: 1, externalId: 1 }).lean();
}

module.exports = { findActiveByExternalIds, list, upsert };
