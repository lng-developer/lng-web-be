const ListingLaunch = require('../models/listingLaunch.model');
const { states } = require('../constants/listingLaunch.constants');
const { normalizePagination, getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');

async function create(payload) {
  return (await ListingLaunch.create(payload)).toObject();
}

function findById(id) {
  return ListingLaunch.findById(id).lean();
}

async function list({ shopIds, shopId, state, ...query } = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = {};
  if (shopIds) filter.shopId = { $in: shopIds };
  if (shopId) {
    filter.shopId = shopIds ? { $in: shopIds, $eq: shopId } : shopId;
  }
  if (state) filter.state = state;
  const [items, total] = await Promise.all([
    ListingLaunch.find(filter).sort({ updatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    ListingLaunch.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

function update(id, patch) {
  return ListingLaunch.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after', runValidators: true }).lean();
}

function selectProduct(id, selection) {
  return ListingLaunch.findOneAndUpdate(
    { _id: id, state: states.BRIEF },
    { $set: { ...selection, state: states.PRODUCT_SELECTED } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = { create, findById, list, update, selectProduct };
