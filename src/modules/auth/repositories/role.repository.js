const Role = require('../models/role.model');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildPrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');

async function findByCode(code, { session } = {}) {
  return Role.findOne({ code: code.toUpperCase() }, null, { session }).lean();
}

async function findById(roleId, { session } = {}) {
  return Role.findById(roleId, null, { session }).lean();
}

async function findByIds(roleIds, { session } = {}) {
  return Role.find({ _id: { $in: roleIds } }, null, { session }).lean();
}

async function touchById(roleId, { session } = {}) {
  return Role.findByIdAndUpdate(
    roleId, { $inc: { mutationVersion: 1 } }, { returnDocument: 'after', session },
  ).lean();
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

async function listAssignable() {
  return Role.find({})
    .select('_id code name description')
    .sort({ name: 1, code: 1 })
    .lean();
}

async function create(payload, { session } = {}) {
  const roles = await Role.create([payload], { session });
  return roles[0].toObject();
}

async function update(roleId, payload, { session } = {}) {
  return Role.findByIdAndUpdate(roleId, { $set: payload }, { returnDocument: 'after', session }).lean();
}

async function addPermission(roleId, permissionId, { session } = {}) {
  return Role.findByIdAndUpdate(
    roleId,
    { $addToSet: { permissions: permissionId } },
    { returnDocument: 'after', session },
  ).lean();
}

async function removePermission(roleId, permissionId, { session } = {}) {
  return Role.findByIdAndUpdate(
    roleId,
    { $pull: { permissions: permissionId } },
    { returnDocument: 'after', session },
  ).lean();
}

async function deleteById(roleId, { session } = {}) {
  return Role.findByIdAndDelete(roleId, { session }).lean();
}

async function countByPermission(permissionId, { session } = {}) {
  const query = Role.countDocuments({ permissions: permissionId });
  return session ? query.session(session) : query;
}

async function findRoleIdsByPermission(permissionId) {
  return Role.find({ permissions: permissionId }).select('_id').lean();
}

module.exports = {
  findByCode,
  findById,
  findByIds,
  touchById,
  list,
  listAssignable,
  create,
  update,
  addPermission,
  removePermission,
  deleteById,
  countByPermission,
  findRoleIdsByPermission,
};
