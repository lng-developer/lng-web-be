const mongoose = require('mongoose');
const Role = require('../models/role.model');
const ScopedRolePermission = require('../models/scopedRolePermission.model');
const AccessAssignment = require('../models/accessAssignment.model');
const ScopeRegistry = require('../models/scopeRegistry.model');
const { accessAssignmentStatuses } = require('../constants/auth.constants');

const objectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(String(id)));
const countMap = (rows) => new Map(rows.map((row) => [String(row._id), row.count]));

async function countPermissionReferences(Model, ids, fields) {
  if (!ids.length) return new Map();
  const selected = objectIds(ids);
  const rows = await Model.aggregate([
    { $match: { $or: fields.map((field) => ({ [field]: { $in: selected } })) } },
    // Count each document once, including permissions repeated across override/custom arrays.
    { $project: {
      ids: { $setIntersection: [
        { $setUnion: fields.map((field) => ({ $ifNull: [`$${field}`, []] })) },
        selected,
      ] },
    } },
    { $unwind: '$ids' },
    { $group: { _id: '$ids', count: { $sum: 1 } } },
  ]);
  return countMap(rows);
}

async function permissionUsage(ids) {
  const [roles, scopedRoles, assignments] = await Promise.all([
    countPermissionReferences(Role, ids, ['permissions']),
    countPermissionReferences(ScopedRolePermission, ids, ['permissions']),
    countPermissionReferences(AccessAssignment, ids, ['customPermissions', 'overridePermissions']),
  ]);
  return { roles, scopedRoles, assignments };
}

async function roleUsage(ids) {
  if (!ids.length) return new Map();
  return countMap(await AccessAssignment.aggregate([
    { $match: { roleId: { $in: objectIds(ids) } } },
    { $group: { _id: '$roleId', count: { $sum: 1 } } },
  ]));
}

function scopeKey(scope) { return `${scope.scopeType}:${scope.scopeId}`; }
function scopeFilters(scopes) {
  return [...new Map(scopes.map((scope) => [scopeKey(scope), {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId == null ? null : new mongoose.Types.ObjectId(String(scope.scopeId)),
  }])).values()];
}

async function scopeUsage(scopes) {
  if (!scopes.length) return new Map();
  const rows = await AccessAssignment.aggregate([
    { $match: { status: accessAssignmentStatuses.ACTIVE, $or: scopeFilters(scopes) } },
    { $group: { _id: { scopeType: '$scopeType', scopeId: '$scopeId' }, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [scopeKey(row._id), row.count]));
}

async function findScopes(scopes) {
  if (!scopes.length) return [];
  return ScopeRegistry.find({ $or: scopeFilters(scopes) }).lean();
}

module.exports = { permissionUsage, roleUsage, scopeUsage, findScopes, scopeKey };
