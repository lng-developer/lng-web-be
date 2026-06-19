const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const ScopedRolePermission = require('../models/scopedRolePermission.model');

function buildListFilter({ scopeType, scopeId, roleId } = {}) {
  const filter = {};

  if (scopeType) {
    filter.scopeType = scopeType;
  }

  if (scopeId) {
    filter.scopeId = scopeId;
  }

  if (roleId) {
    filter.roleId = roleId;
  }

  return filter;
}

async function upsert({ scopeType, scopeId, roleId, permissions }) {
  const rule = await ScopedRolePermission.findOneAndUpdate(
    { scopeType, scopeId, roleId },
    {
      $set: {
        permissions,
      },
      $setOnInsert: {
        scopeType,
        scopeId,
        roleId,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  return rule.toObject ? rule.toObject() : rule;
}

async function list({ page = 1, limit = 50, ...filters } = {}) {
  const filter = buildListFilter(filters);
  const [items, total] = await Promise.all([
    ScopedRolePermission.find(filter)
      .sort({ scopeType: 1, scopeId: 1, roleId: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    ScopedRolePermission.countDocuments(filter),
  ]);

  return toPaginatedResult({
    items,
    total,
    page,
    limit,
  });
}

async function countByPermission(permissionId) {
  return ScopedRolePermission.countDocuments({ permissions: permissionId });
}

async function findRoleIdsByPermission(permissionId) {
  return ScopedRolePermission.find({ permissions: permissionId }).select('roleId').lean();
}

module.exports = {
  upsert,
  list,
  countByPermission,
  findRoleIdsByPermission,
};
