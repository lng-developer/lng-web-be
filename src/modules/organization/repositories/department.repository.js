const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const Department = require('../models/department.model');

function buildFilter({ status, search } = {}) {
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (search) {
    filter.$or = [
      { code: { $regex: search, $options: 'i' } },
      { name: { $regex: search, $options: 'i' } },
    ];
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

module.exports = {
  create,
  findById,
  findByCode,
  list,
  update,
};
