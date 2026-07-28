const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const Shop = require('../models/shop.model');

function buildFilter({
  id, status, search, shopIds,
} = {}) {
  const filter = {};

  if (id) {
    filter._id = id;
  }

  if (status) {
    filter.status = status;
  }

  if (shopIds && shopIds.length > 0) {
    filter._id = { $in: shopIds };
  }

  const nameRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(search));

  if (nameRegex) {
    filter.name = nameRegex;
  }

  return filter;
}

async function create(payload, { session } = {}) {
  const shops = await Shop.create([payload], { session });
  return shops[0].toObject();
}

async function findById(shopId) {
  return Shop.findById(shopId).lean();
}

async function updateStatus(shopId, status, { session } = {}) {
  return Shop.findByIdAndUpdate(
    shopId,
    { $set: { status } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    Shop.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Shop.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

module.exports = {
  create,
  findById,
  updateStatus,
  list,
};
