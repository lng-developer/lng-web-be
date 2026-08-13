const mongoose = require('mongoose');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const {
  accessAssignmentStatuses,
  accessScopeTypes,
} = require('../constants/auth.constants');
const AccessAssignment = require('../models/accessAssignment.model');
const Account = require('../models/account.model');

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

function normalizeScopeFilters(scopes = []) {
  return (scopes || [])
    .map((scope) => ({
      scopeType: scope?.scopeType,
      scopeId: scope?.scopeId,
    }))
    .filter((scope) => scope.scopeType && scope.scopeId);
}

async function findAccountIdsByScopes(scopes = []) {
  const normalized = normalizeScopeFilters(scopes);
  if (!normalized.length) return [];
  const filter = {
    status: accessAssignmentStatuses.ACTIVE,
    $or: normalized.map((scope) => ({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    })),
  };
  return AccessAssignment.find(filter).select('accountId').lean();
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

async function findById(assignmentId, { session } = {}) {
  return AccessAssignment.findById(assignmentId, null, { session }).lean();
}

async function findActiveByAccountRoleScope(accountId, roleId, scopeType, scopeId, { session } = {}) {
  return AccessAssignment.findOne({
    accountId,
    roleId,
    scopeType,
    scopeId,
    status: accessAssignmentStatuses.ACTIVE,
  }, null, { session }).lean();
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

async function update(assignmentId, payload, { session } = {}) {
  return AccessAssignment.findByIdAndUpdate(
    assignmentId,
    { $set: payload },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function deactivate(assignmentId, { session } = {}) {
  return AccessAssignment.findByIdAndUpdate(
    assignmentId,
    { $set: { status: accessAssignmentStatuses.INACTIVE } },
    { returnDocument: 'after', runValidators: true, session },
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
        ...(payload.overridePermissions !== undefined
          ? { overridePermissions: payload.overridePermissions }
          : {}),
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
      returnDocument: 'after',
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

async function deactivateActiveByAccountId(accountId, { session } = {}) {
  return AccessAssignment.updateMany(
    { accountId, status: accessAssignmentStatuses.ACTIVE },
    { $set: { status: accessAssignmentStatuses.INACTIVE } },
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

async function countByRole(roleId, { session } = {}) {
  const query = AccessAssignment.countDocuments({
    roleId,
  });
  return session ? query.session(session) : query;
}

async function findAccountIdsByCustomPermission(permissionId) {
  return AccessAssignment.find({
    $or: [
      { customPermissions: permissionId },
      { overridePermissions: permissionId },
    ],
    status: accessAssignmentStatuses.ACTIVE,
  }).select('accountId').lean();
}

async function countByCustomPermission(permissionId, { session } = {}) {
  const query = AccessAssignment.countDocuments({
    $or: [
      { customPermissions: permissionId },
      { overridePermissions: permissionId },
    ],
  });
  return session ? query.session(session) : query;
}

async function countActiveByScope(scopeType, scopeId, { session } = {}) {
  const query = AccessAssignment.countDocuments({
    scopeType,
    scopeId,
    status: accessAssignmentStatuses.ACTIVE,
  });
  return session ? query.session(session) : query;
}

async function hasOtherActiveGlobalRoleAccount(roleId, excludedAccountId, { session } = {}) {
  const query = AccessAssignment.aggregate([
    {
      $match: {
        roleId: new mongoose.Types.ObjectId(roleId),
        accountId: { $ne: new mongoose.Types.ObjectId(excludedAccountId) },
        scopeType: accessScopeTypes.GLOBAL,
        scopeId: null,
        status: accessAssignmentStatuses.ACTIVE,
      },
    },
    {
      $lookup: {
        from: Account.collection.name,
        localField: 'accountId',
        foreignField: '_id',
        as: 'account',
      },
    },
    { $match: { 'account.status': 'active' } },
    { $limit: 1 },
  ]);
  const assignments = session ? await query.session(session) : await query;
  return assignments.length > 0;
}

module.exports = {
  create,
  createMany,
  findById,
  findActiveByAccountRoleScope,
  list,
  findAccountIdsByScopes,
  update,
  deactivate,
  deactivateActiveGlobalByAccount,
  upsertActiveScopedRole,
  deactivateActiveByAccountRoleScope,
  deactivateActiveByAccountScope,
  deactivateActiveByAccountId,
  findAccountIdsByRole,
  findAccountIdsByRoles,
  countByRole,
  findAccountIdsByCustomPermission,
  countByCustomPermission,
  countActiveByScope,
  hasOtherActiveGlobalRoleAccount,
};
