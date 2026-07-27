const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildPrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const Department = require('../models/department.model');

function buildFilter({ ids, status, search } = {}) {
  const filter = {};

  if (ids && ids.length > 0) {
    filter._id = { $in: ids };
  }

  if (status) {
    filter.status = status;
  }

  const normalizedSearch = normalizeSearchTerm(search);
  const codeRegex = buildPrefixRegex(normalizedSearch.toUpperCase());

  if (codeRegex) {
    filter.code = codeRegex;
  }

  return filter;
}

async function create(payload, { session } = {}) {
  const departments = await Department.create([payload], { session });
  return departments[0].toObject();
}

async function findById(departmentId) {
  return Department.findById(departmentId).lean();
}

async function findByCode(code) {
  return Department.findOne({ code: String(code).toUpperCase() }).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    Department.find(filter)
      .sort({ code: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Department.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function update(departmentId, payload) {
  return Department.findByIdAndUpdate(
    departmentId,
    { $set: payload },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function migrateLegacyDepartments(items = [], { apply = false } = {}) {
  if (!apply || !items.length) return { inserted: 0, updated: 0, unchanged: 0, failed: 0 };
  const result = await Department.bulkWrite(items.map((item) => {
    const { _id, ...payload } = item;
    return { updateOne: { filter: { code: item.code }, update: { $set: payload, ...(item._id ? { $setOnInsert: { _id: item._id } } : {}) }, upsert: true } };
  }), { ordered: false });
  const inserted = Number(result.upsertedCount || 0);
  const updated = Number(result.modifiedCount || 0);
  return { inserted, updated, unchanged: Math.max(0, Number(result.matchedCount || 0) - updated), failed: 0 };
}

module.exports = {
  create,
  findById,
  findByCode,
  list,
  update,
  migrateLegacyDepartments,
};
