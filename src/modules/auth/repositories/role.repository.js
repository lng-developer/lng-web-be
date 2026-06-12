const Role = require('../models/role.model');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');

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

  if (search) {
    filter.$or = [
      { code: { $regex: search, $options: 'i' } },
      { name: { $regex: search, $options: 'i' } },
    ];
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
  return Role.findByIdAndUpdate(roleId, { $set: payload }, { new: true }).lean();
}

async function addPermission(roleId, permissionId) {
  return Role.findByIdAndUpdate(
    roleId,
    { $addToSet: { permissions: permissionId } },
    { new: true },
  ).lean();
}

async function removePermission(roleId, permissionId) {
  return Role.findByIdAndUpdate(
    roleId,
    { $pull: { permissions: permissionId } },
    { new: true },
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
