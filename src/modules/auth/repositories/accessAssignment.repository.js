const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const {
  accessAssignmentStatuses,
  accessScopeTypes,
} = require('../constants/auth.constants');
const AccessAssignment = require('../models/accessAssignment.model');

function buildListFilter({ accountId, roleId, scopeType, scopeId, status } = {}) {
  const filter = {};

  if (accountId) {
    filter.accountId = accountId;
  }

  if (roleId) {
    filter.roleId = roleId;
  }

  if (scopeType) {
    filter.scopeType = scopeType;
  }

  if (scopeId) {
    filter.scopeId = scopeId;
  }

  if (status) {
    filter.status = status;
  }

  return filter;
}

async function create(payload, { session } = {}) {
  const assignments = await AccessAssignment.create([payload], { session });
  return assignments[0].toObject();
}

async function createMany(payloads, { session } = {}) {
  if (payloads.length === 0) {
    return [];
  }

  const assignments = await AccessAssignment.insertMany(payloads, { session });
  return assignments.map((assignment) => assignment.toObject());
}

async function findById(assignmentId) {
  return AccessAssignment.findById(assignmentId).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildListFilter(filters);
  const [items, total] = await Promise.all([
    AccessAssignment.find(filter)
      .sort({ createdAt: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    AccessAssignment.countDocuments(filter),
  ]);

  return toPaginatedResult({
    items,
    total,
    page,
    limit,
  });
}

async function update(assignmentId, payload) {
  return AccessAssignment.findByIdAndUpdate(
    assignmentId,
    { $set: payload },
    { new: true, runValidators: true },
  ).lean();
}

async function deactivate(assignmentId) {
  return AccessAssignment.findByIdAndUpdate(
    assignmentId,
    { $set: { status: accessAssignmentStatuses.INACTIVE } },
    { new: true, runValidators: true },
  ).lean();
}

async function deactivateActiveGlobalByAccount(accountId, { session } = {}) {
  return AccessAssignment.updateMany(
    {
      accountId,
      scopeType: accessScopeTypes.GLOBAL,
      status: accessAssignmentStatuses.ACTIVE,
    },
    {
      $set: { status: accessAssignmentStatuses.INACTIVE },
    },
    { session, runValidators: true },
  );
}

async function upsertActiveScopedRole(payload, { session } = {}) {
  const assignment = await AccessAssignment.findOneAndUpdate(
    {
      accountId: payload.accountId,
      roleId: payload.roleId,
      scopeType: payload.scopeType,
      scopeId: payload.scopeId,
      status: accessAssignmentStatuses.ACTIVE,
    },
    {
      $set: {
        customPermissions: payload.customPermissions || [],
        status: accessAssignmentStatuses.ACTIVE,
      },
      $setOnInsert: {
        accountId: payload.accountId,
        roleId: payload.roleId,
        scopeType: payload.scopeType,
        scopeId: payload.scopeId,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      session,
    },
  );

  return assignment.toObject ? assignment.toObject() : assignment;
}

async function deactivateActiveByAccountRoleScope(accountId, roleId, scopeType, scopeId, { session } = {}) {
  return AccessAssignment.updateMany(
    {
      accountId,
      roleId,
      scopeType,
      scopeId,
      status: accessAssignmentStatuses.ACTIVE,
    },
    {
      $set: { status: accessAssignmentStatuses.INACTIVE },
    },
    { session, runValidators: true },
  );
}

async function deactivateActiveByAccountScope(accountId, scopeType, scopeId, { session } = {}) {
  return AccessAssignment.updateMany(
    {
      accountId,
      scopeType,
      scopeId,
      status: accessAssignmentStatuses.ACTIVE,
    },
    {
      $set: { status: accessAssignmentStatuses.INACTIVE },
    },
    { session, runValidators: true },
  );
}

async function findAccountIdsByRole(roleId) {
  return AccessAssignment.find({
    roleId,
    status: accessAssignmentStatuses.ACTIVE,
  }).select('accountId').lean();
}

async function findAccountIdsByRoles(roleIds) {
  return AccessAssignment.find({
    roleId: { $in: roleIds },
    status: accessAssignmentStatuses.ACTIVE,
  }).select('accountId').lean();
}

async function countByRole(roleId) {
  return AccessAssignment.countDocuments({
    roleId,
    status: accessAssignmentStatuses.ACTIVE,
  });
}

async function findAccountIdsByCustomPermission(permissionId) {
  return AccessAssignment.find({
    customPermissions: permissionId,
    status: accessAssignmentStatuses.ACTIVE,
  }).select('accountId').lean();
}

async function countByCustomPermission(permissionId) {
  return AccessAssignment.countDocuments({
    customPermissions: permissionId,
    status: accessAssignmentStatuses.ACTIVE,
  });
}

async function countActiveByScope(scopeType, scopeId) {
  return AccessAssignment.countDocuments({
    scopeType,
    scopeId,
    status: accessAssignmentStatuses.ACTIVE,
  });
}

module.exports = {
  create,
  createMany,
  findById,
  list,
  update,
  deactivate,
  deactivateActiveGlobalByAccount,
  upsertActiveScopedRole,
  deactivateActiveByAccountRoleScope,
  deactivateActiveByAccountScope,
  findAccountIdsByRole,
  findAccountIdsByRoles,
  countByRole,
  findAccountIdsByCustomPermission,
  countByCustomPermission,
  countActiveByScope,
};
