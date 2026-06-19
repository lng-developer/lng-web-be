const Permission = require('../models/permission.model');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildPrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');

async function findById(permissionId) {
  return Permission.findById(permissionId).lean();
}

async function findByCode(code) {
  return Permission.findOne({ code: code.toUpperCase() }).lean();
}

async function findByIds(permissionIds) {
  return Permission.find({ _id: { $in: permissionIds } }).lean();
}

async function list({ search, page = 1, limit = 100 } = {}) {
  const filter = {};

  const searchRegex = buildPrefixRegex(normalizeSearchTerm(search).toUpperCase());

  if (searchRegex) {
    filter.code = searchRegex;
  }

  const [items, total] = await Promise.all([
    Permission.find(filter).sort({ code: 1 }).skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    Permission.countDocuments(filter),
  ]);

  return toPaginatedResult({
    items,
    total,
    page,
    limit,
  });
}

async function create(payload) {
  const permission = await Permission.create(payload);
  return permission.toObject();
}

async function update(permissionId, payload) {
  return Permission.findByIdAndUpdate(permissionId, { $set: payload }, { returnDocument: 'after' }).lean();
}

async function deleteById(permissionId) {
  return Permission.findByIdAndDelete(permissionId).lean();
}

module.exports = {
  findById,
  findByCode,
  findByIds,
  list,
  create,
  update,
  deleteById,
};
