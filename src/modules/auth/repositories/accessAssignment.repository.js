const mongoose = require('mongoose');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { accessAssignmentStatuses } = require('../constants/auth.constants');
const AccessAssignment = require('../models/accessAssignment.model');

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return new mongoose.Types.ObjectId(value);
}

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

async function create(payload) {
  const assignment = await AccessAssignment.create(payload);
  return assignment.toObject();
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
    { new: true },
  ).lean();
}

async function deactivate(assignmentId) {
  return AccessAssignment.findByIdAndUpdate(
    assignmentId,
    { $set: { status: accessAssignmentStatuses.INACTIVE } },
    { new: true },
  ).lean();
}

async function findAccountIdsByRole(roleId) {
  return AccessAssignment.find({
    roleId,
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

async function findResolvedByAccountId(accountId) {
  return AccessAssignment.aggregate([
    {
      $match: {
        accountId: toObjectId(accountId),
        status: accessAssignmentStatuses.ACTIVE,
      },
    },
    {
      $lookup: {
        from: 'roles',
        localField: 'roleId',
        foreignField: '_id',
        as: 'role',
      },
    },
    { $unwind: '$role' },
    {
      $lookup: {
        from: 'permissions',
        localField: 'role.permissions',
        foreignField: '_id',
        as: 'rolePermissionDocs',
      },
    },
    {
      $lookup: {
        from: 'permissions',
        localField: 'customPermissions',
        foreignField: '_id',
        as: 'customPermissionDocs',
      },
    },
    {
      $project: {
        assignmentId: '$_id',
        scopeType: 1,
        scopeId: 1,
        status: 1,
        role: { $toUpper: '$role.code' },
        rolePermissionCodes: {
          $map: {
            input: '$rolePermissionDocs',
            as: 'permission',
            in: { $toUpper: '$$permission.code' },
          },
        },
        customPermissionCodes: {
          $map: {
            input: '$customPermissionDocs',
            as: 'permission',
            in: { $toUpper: '$$permission.code' },
          },
        },
      },
    },
    {
      $project: {
        assignmentId: 1,
        scopeType: 1,
        scopeId: 1,
        status: 1,
        roles: ['$role'],
        permissions: {
          $setUnion: ['$rolePermissionCodes', '$customPermissionCodes'],
        },
      },
    },
  ]);
}

module.exports = {
  create,
  findById,
  list,
  update,
  deactivate,
  findAccountIdsByRole,
  countByRole,
  findAccountIdsByCustomPermission,
  countByCustomPermission,
  findResolvedByAccountId,
};
