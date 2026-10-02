const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const { disconnectRedis } = require('../../../config/redis');
const logger = require('../../../shared/utils/logger');
const Account = require('../models/account.model');
const AccessAssignment = require('../models/accessAssignment.model');
const Role = require('../models/role.model');
const organizationPublic = require('../../organization/public');
const authManager = require('../services/authManager.service');
const { accessAssignmentStatuses, accessScopeTypes, roleCodes } = require('../constants/auth.constants');

const SCALE_TEAM_CODE = 'DES';

function toId(value) {
  return value == null ? null : String(value._id || value.id || value);
}

function parseArgs(argv = process.argv.slice(2)) {
  return { apply: argv.includes('--apply') };
}

function assignmentKey(accountId, roleId, scopeType) {
  return [accountId, roleId, scopeType].join(':');
}

function buildProductionScaleAssignmentPlan(context) {
  const requiredRoleCodes = [roleCodes.SCALE_OPERATOR, roleCodes.SCALE_LEADER, roleCodes.CS_OPERATOR];
  for (const roleCode of requiredRoleCodes) {
    if (!context.rolesByCode.get(roleCode)) throw new Error(`${roleCode} role is missing. Run seed:rbac first.`);
  }
  const activeAssignments = (context.assignments || []).filter(
    (assignment) => assignment.status === accessAssignmentStatuses.ACTIVE,
  );
  const activeKeys = new Set(activeAssignments.map((assignment) => (
    assignmentKey(toId(assignment.accountId), toId(assignment.roleId), assignment.scopeType)
  )));
  const csOperatorRoleId = toId(context.rolesByCode.get(roleCodes.CS_OPERATOR));
  const create = [];
  const keep = [];
  for (const membership of context.memberships || []) {
    const account = context.accountsById.get(toId(membership.accountId));
    const team = context.teamsById.get(toId(membership.teamId));
    if (!account || team?.code !== SCALE_TEAM_CODE) continue;
    const leader = String(membership.memberType || '').toLowerCase() === 'leader';
    const isCsOperator = activeAssignments.some((assignment) => (
      toId(assignment.accountId) === toId(account)
      && toId(assignment.roleId) === csOperatorRoleId
    ));
    if (!leader && !isCsOperator) continue;
    const roleCode = leader ? roleCodes.SCALE_LEADER : roleCodes.SCALE_OPERATOR;
    const role = context.rolesByCode.get(roleCode);
    const target = {
      accountId: toId(account),
      email: account.email,
      roleId: toId(role),
      roleCode,
      scopeType: leader ? accessScopeTypes.GLOBAL : accessScopeTypes.OWN,
      scopeId: null,
    };
    if (activeKeys.has(assignmentKey(target.accountId, target.roleId, target.scopeType))) keep.push(target);
    else create.push(target);
  }
  return { create, keep, deactivate: [] };
}

async function loadContext() {
  const roleCodesToLoad = [roleCodes.SCALE_OPERATOR, roleCodes.SCALE_LEADER, roleCodes.CS_OPERATOR];
  const [roles, organizationSource, accounts, assignments] = await Promise.all([
    Role.find({ code: { $in: roleCodesToLoad } }).lean(),
    organizationPublic.listRoleAssignmentSource({ includeInactive: false }),
    Account.find({ status: 'active' }).select('_id email').lean(),
    AccessAssignment.find({ status: accessAssignmentStatuses.ACTIVE }).lean(),
  ]);
  return {
    rolesByCode: new Map(roles.map((role) => [role.code, role])),
    teamsById: new Map(organizationSource.teams.map((team) => [toId(team), team])),
    accountsById: new Map(accounts.map((account) => [toId(account), account])),
    memberships: organizationSource.memberships,
    assignments,
  };
}

async function applyPlan(plan) {
  for (const target of plan.create) {
    const assignmentFilter = {
      accountId: target.accountId,
      roleId: target.roleId,
      scopeType: target.scopeType,
      scopeId: null,
    };
    const assignmentOnInsert = {
      ...assignmentFilter,
      customPermissions: [],
    };
    await AccessAssignment.findOneAndUpdate(
      assignmentFilter,
      {
        $set: { status: accessAssignmentStatuses.ACTIVE },
        $setOnInsert: assignmentOnInsert,
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }
  await Promise.all(plan.create.map((target) => authManager.invalidatePermissionCache(target.accountId)));
}

async function migrateProductionScaleAssignments(options = parseArgs()) {
  await connectDatabase();
  try {
    const plan = buildProductionScaleAssignmentPlan(await loadContext());
    const result = {
      apply: options.apply,
      database: mongoose.connection.db.databaseName,
      assignmentsToCreate: plan.create.length,
      assignmentsToKeep: plan.keep.length,
    };
    if (options.apply) await applyPlan(plan);
    logger.info('production_scale_assignment_migration_completed', result);
    return result;
  } finally {
    await disconnectRedis();
    await disconnectDatabase();
  }
}

if (require.main === module) {
  migrateProductionScaleAssignments().catch((error) => {
    logger.error('production_scale_assignment_migration_failed', { error });
    process.exit(1);
  });
}

module.exports = { buildProductionScaleAssignmentPlan, migrateProductionScaleAssignments };
