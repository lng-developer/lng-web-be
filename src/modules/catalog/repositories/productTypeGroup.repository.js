const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const ProductTypeGroup = require('../models/productTypeGroup.model');

function buildFilter({ status, search } = {}) {
  const filter = {};
  if (status) filter.status = status;

  const regex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(search));
  if (regex) filter.$or = [{ code: regex }, { name: regex }];

  return filter;
}

async function create(payload) {
  const group = await ProductTypeGroup.create(payload);
  return group.toObject();
}

async function findById(groupId) {
  return ProductTypeGroup.findById(groupId).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    ProductTypeGroup.find(filter)
      .sort({ sortOrder: 1, name: 1, code: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    ProductTypeGroup.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function update(groupId, patch) {
  return ProductTypeGroup.findByIdAndUpdate(
    groupId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  list,
  update,
};
