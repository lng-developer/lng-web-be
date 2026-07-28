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

async function findByScopeRole(scopeType, scopeId, roleId, { session } = {}) {
  return ScopedRolePermission.findOne({ scopeType, scopeId, roleId }, null, { session }).lean();
}

async function upsert({ scopeType, scopeId, roleId, permissions }, { session } = {}) {
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
      session,
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

async function countByPermission(permissionId, { session } = {}) {
  const query = ScopedRolePermission.countDocuments({ permissions: permissionId });
  return session ? query.session(session) : query;
}

async function countByRole(roleId, { session } = {}) {
  const query = ScopedRolePermission.countDocuments({ roleId });
  return session ? query.session(session) : query;
}

async function findRoleIdsByPermission(permissionId) {
  return ScopedRolePermission.find({ permissions: permissionId }).select('roleId').lean();
}

module.exports = {
  findByScopeRole,
  upsert,
  list,
  countByPermission,
  countByRole,
  findRoleIdsByPermission,
};
