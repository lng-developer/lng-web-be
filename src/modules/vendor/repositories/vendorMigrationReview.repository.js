const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitiveContainsRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const VendorMigrationReview = require('../models/vendorMigrationReview.model');

function buildFilter({ q } = {}) {
  const text = normalizeSearchTerm(q);
  if (!text) return { status: 'PENDING' };
  const regex = buildCaseInsensitiveContainsRegex(text);
  return { status: 'PENDING', $or: [{ vendorCode: regex }, { code: regex }, { name: regex }, { externalProductId: regex }] };
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    VendorMigrationReview.find(filter).sort({ vendorCode: 1, code: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    VendorMigrationReview.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function countPending() {
  return VendorMigrationReview.countDocuments({ status: 'PENDING' });
}

async function assignProductTypeGroup(legacyProductIds, productTypeGroupId) {
  const result = await VendorMigrationReview.updateMany(
    { legacyProductId: { $in: legacyProductIds } },
    { $set: { productTypeGroupId, status: 'ASSIGNED' } },
  );
  return result.modifiedCount;
}

async function upsert(row) {
  return VendorMigrationReview.findOneAndUpdate(
    { legacyProductId: row.legacyProductId },
    { $set: row, $setOnInsert: { status: 'PENDING' } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = { list, countPending, assignProductTypeGroup, upsert, buildFilter };
