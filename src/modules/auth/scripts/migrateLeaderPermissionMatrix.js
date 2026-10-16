const { leaderHrPermissions, leaderRoleName } = require('../constants/leaderPermissionMatrix');

const id = value => value == null ? null : String(value);
const ids = values => [...new Set((values || []).map(id))];
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const scopeKey = row => [id(row.accountId), row.scopeType, id(row.scopeId)].join(':');

function buildLeaderPermissionPlan({ roles, permissions, scopedRules, assignments }, now = new Date()) {
  const byCode = new Map(permissions.map(p => [p.code, id(p._id)]));
  const byId = new Map(permissions.map(p => [id(p._id), p.code]));
  const required = [...leaderHrPermissions, 'REPORTS:READ'];
  for (const code of required) if (!byCode.has(code)) throw new Error(`Missing permission: ${code}`);
  const leader = roles.find(r => r.code === 'LEADER');
  const sales = roles.find(r => r.code === 'SALES_LEADER');
  if (!leader || !sales) throw new Error('LEADER and SALES_LEADER roles are required');
  const hrIds = leaderHrPermissions.map(code => byCode.get(code));
  const reportId = byCode.get('REPORTS:READ');
  const changes = [];
  const blockers = [];
  const warnings = [];
  const targetRoleIds = new Set([id(leader._id), id(sales._id)]);
  const add = (collection, row, after) => {
    const before = Object.fromEntries(Object.keys(after).map(key => [key, row[key]]));
    if (!equal(before, after)) changes.push({ collection, id: id(row._id), before, after });
  };
  add('roles', leader, { name: leaderRoleName, permissions: hrIds });
  add('roles', sales, { permissions: ids([...sales.permissions, reportId]) });
  for (const rule of scopedRules) {
    if (id(rule.roleId) === id(leader._id)) add('scopedRules', rule, { permissions: hrIds });
    if (id(rule.roleId) === id(sales._id)) add('scopedRules', rule, { permissions: ids([...rule.permissions, reportId]) });
  }
  for (const assignment of assignments) {
    if (!targetRoleIds.has(id(assignment.roleId))) continue;
    if (assignment.status === 'active' && assignment.scopeType !== 'team') blockers.push(`NON_TEAM_ASSIGNMENT:${id(assignment._id)}`);
    if (id(assignment.roleId) === id(leader._id)) {
      const after = { customPermissions: ids(assignment.customPermissions).filter(p => hrIds.includes(p)) };
      if (Array.isArray(assignment.overridePermissions)) after.overridePermissions = ids(assignment.overridePermissions).filter(p => hrIds.includes(p));
      add('assignments', assignment, after);
    } else if (Array.isArray(assignment.overridePermissions) && !ids(assignment.overridePermissions).includes(reportId)) {
      warnings.push(`SALES_REPORT_OVERRIDE:${id(assignment._id)}`);
    }
  }
  const changed = (collection, row) => ({ ...row, ...changes.find(c => c.collection === collection && c.id === id(row._id))?.after });
  const active = assignments.filter(a => a.status === 'active'
    && (!a.validFrom || new Date(a.validFrom) <= now) && (!a.validUntil || new Date(a.validUntil) > now));
  const effective = (rows, after) => [...new Set(rows.flatMap(original => {
    const a = after ? changed('assignments', original) : original;
    if (Array.isArray(a.overridePermissions)) return ids(a.overridePermissions);
    const role = roles.find(r => id(r._id) === id(a.roleId));
    const rule = scopedRules.find(r => id(r.roleId) === id(a.roleId) && r.scopeType === a.scopeType && id(r.scopeId) === id(a.scopeId));
    const inherited = rule ? (after ? changed('scopedRules', rule) : rule) : (role && (after ? changed('roles', role) : role));
    return [...ids(inherited?.permissions), ...ids(a.customPermissions)];
  }))].map(p => byId.get(p) || `UNKNOWN:${p}`).sort();
  const affectedKeys = new Set(active.filter(a => targetRoleIds.has(id(a.roleId))).map(scopeKey));
  const impacts = [...affectedKeys].map(key => {
    const rows = active.filter(a => scopeKey(a) === key);
    const before = effective(rows, false);
    const after = effective(rows, true);
    return { accountId: id(rows[0].accountId), scopeType: rows[0].scopeType, scopeId: id(rows[0].scopeId), before, after,
      added: after.filter(p => !before.includes(p)), removed: before.filter(p => !after.includes(p)) };
  });
  return { changes, impacts, blockers, warnings };
}

async function runLeaderPermissionMigration({ apply = false, expectedDatabase } = {}) {
  const mongoose = require('mongoose');
  const { randomUUID } = require('node:crypto');
  const models = {
    roles: require('../models/role.model'),
    scopedRules: require('../models/scopedRolePermission.model'),
    assignments: require('../models/accessAssignment.model'),
  };
  const Permission = require('../models/permission.model');
  const audit = require('../../audit/public');
  const authManager = require('../services/authManager.service');
  const database = mongoose.connection.db.databaseName;
  if (apply && expectedDatabase !== database) throw new Error('Database confirmation must match the connected database');
  const load = async (session = null) => {
    const context = {};
    // Transactions must not share a session across concurrent queries.
    for (const [key, model] of Object.entries(models)) context[key] = await model.find({}).session(session).lean();
    context.permissions = await Permission.find({}).session(session).lean();
    return context;
  };
  if (!apply) return { database, apply, ...buildLeaderPermissionPlan(await load()) };
  const session = await mongoose.startSession();
  let plan;
  let affectedAccountIds;
  const operationId = randomUUID();
  try {
    await session.withTransaction(async () => {
      const context = await load(session);
      plan = buildLeaderPermissionPlan(context);
      if (plan.blockers.length) throw new Error(plan.blockers.join(', '));
      for (const change of plan.changes) {
        await models[change.collection].updateOne({ _id: change.id }, { $set: change.after }, { session, runValidators: true });
        await audit.record({
          actorType: 'SYSTEM', actorAccountId: null, actorSnapshot: {},
          action: 'LEADER_PERMISSION_MATRIX_UPDATED', entityType: 'AUTH_PERMISSION_MATRIX', entityId: change.id,
          outcome: 'SUCCEEDED', source: 'SYSTEM',
          changes: Object.fromEntries(Object.keys(change.after).map(key => [key, { before: change.before[key], after: change.after[key] }])),
          metadata: { operationId, collection: change.collection, database },
          deduplicationKey: `leader-matrix:${operationId}:${change.collection}:${change.id}`,
        }, { session });
      }
      const roleIds = new Set(context.roles.filter(r => ['LEADER', 'SALES_LEADER'].includes(r.code)).map(r => id(r._id)));
      affectedAccountIds = ids(context.assignments.filter(a => roleIds.has(id(a.roleId))).map(a => a.accountId));
    });
  } finally {
    await session.endSession();
  }
  // Also invalidate on a no-op rerun, allowing recovery after a post-commit cache failure.
  try {
    for (const accountId of affectedAccountIds) await authManager.invalidatePermissionCache(accountId, { strict: true });
  } catch (cause) {
    throw new Error(`Database committed; permission cache invalidation failed. Rerun migration. Operation: ${operationId}`, { cause });
  }
  return { database, apply, operationId, ...plan };
}

if (require.main === module) {
  const { connectDatabase, disconnectDatabase } = require('../../../config/database');
  const { disconnectRedis } = require('../../../config/redis');
  const logger = require('../../../shared/utils/logger');
  (async () => {
    try {
      await connectDatabase();
      const args = process.argv.slice(2);
      const result = await runLeaderPermissionMigration({ apply: args.includes('--apply'), expectedDatabase: args.find(a => a.startsWith('--database='))?.slice('--database='.length) });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await disconnectRedis();
      await disconnectDatabase();
    }
  })().catch(error => {
    logger.error('leader_permission_matrix_migration_failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { buildLeaderPermissionPlan, runLeaderPermissionMigration };
