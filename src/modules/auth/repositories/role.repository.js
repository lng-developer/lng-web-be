const Role = require('../models/role.model');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildPrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');

async function findByCode(code) {
  return Role.findOne({ code: code.toUpperCase() }).lean();
}

async function findById(roleId) {
  return Role.findById(roleId).lean();
}

async function findByIds(roleIds) {
  return Role.find({ _id: { $in: roleIds } }).lean();
}

async function list({ search, page = 1, limit = 50 } = {}) {
  const filter = {};

  const normalizedSearch = normalizeSearchTerm(search);
  const codeRegex = buildPrefixRegex(normalizedSearch.toUpperCase());

  if (codeRegex) {
    filter.code = codeRegex;
  }

  const [items, total] = await Promise.all([
    Role.find(filter).sort({ code: 1 }).skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    Role.countDocuments(filter),
  ]);

  return toPaginatedResult({
    items,
    total,
    page,
    limit,
  });
}

async function create(payload) {
  const role = await Role.create(payload);
  return role.toObject();
}

async function update(roleId, payload) {
  return Role.findByIdAndUpdate(roleId, { $set: payload }, { returnDocument: 'after' }).lean();
}

async function addPermission(roleId, permissionId) {
  return Role.findByIdAndUpdate(
    roleId,
    { $addToSet: { permissions: permissionId } },
    { returnDocument: 'after' },
  ).lean();
}

async function removePermission(roleId, permissionId) {
  return Role.findByIdAndUpdate(
    roleId,
    { $pull: { permissions: permissionId } },
    { returnDocument: 'after' },
  ).lean();
}

async function deleteById(roleId) {
  return Role.findByIdAndDelete(roleId).lean();
}

async function countByPermission(permissionId) {
  return Role.countDocuments({ permissions: permissionId });
}

async function findRoleIdsByPermission(permissionId) {
  return Role.find({ permissions: permissionId }).select('_id').lean();
}

module.exports = {
  findByCode,
  findById,
  findByIds,
  list,
  create,
  update,
  addPermission,
  removePermission,
  deleteById,
  countByPermission,
  findRoleIdsByPermission,
};
