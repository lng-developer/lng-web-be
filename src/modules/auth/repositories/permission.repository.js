const Permission = require('../models/permission.model');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildPrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');

async function findById(permissionId, { session } = {}) {
  return Permission.findById(permissionId, null, { session }).lean();
}

async function findByCode(code) {
  return Permission.findOne({ code: code.toUpperCase() }).lean();
}

async function findByIds(permissionIds) {
  return Permission.find({ _id: { $in: permissionIds } }).lean();
}

async function listByCodes(codes = []) {
  return Permission.find({ code: { $in: codes } }).select('code').lean();
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

async function create(payload, { session } = {}) {
  const permissions = await Permission.create([payload], { session });
  return permissions[0].toObject();
}

async function update(permissionId, payload, { session } = {}) {
  return Permission.findByIdAndUpdate(
    permissionId, { $set: payload }, { returnDocument: 'after', session },
  ).lean();
}

async function deleteById(permissionId, { session } = {}) {
  return Permission.findByIdAndDelete(permissionId, { session }).lean();
}

module.exports = {
  findById,
  findByCode,
  findByIds,
  listByCodes,
  list,
  create,
  update,
  deleteById,
};
