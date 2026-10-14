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

const TEAM_ROLE_TARGETS = Object.freeze({
  SALE1: { member: roleCodes.CS_OPERATOR, leader: roleCodes.SALES_LEADER },
  DES: { member: roleCodes.DESIGNER, leader: roleCodes.DESIGN_LEADER },
});

const toId = (value) => value == null ? null : String(value._id || value.id || value);
const parseArgs = (argv = process.argv.slice(2)) => ({ apply: argv.includes('--apply') });
const assignmentKey = (accountId, roleId, scopeType, scopeId) => [accountId, roleId, scopeType, scopeId].join(':');

function buildOrderDesignAssignmentPlan(context) {
  const requiredRoles = [...new Set(Object.values(TEAM_ROLE_TARGETS).flatMap(Object.values))];
  for (const roleCode of requiredRoles) {
    if (!context.rolesByCode.get(roleCode)) throw new Error(`${roleCode} role is missing. Run seed:rbac first.`);
  }
  const activeAssignments = (context.assignments || []).filter((assignment) => assignment.status === accessAssignmentStatuses.ACTIVE);
  const activeKeys = new Set(activeAssignments.map((assignment) => assignmentKey(
    toId(assignment.accountId), toId(assignment.roleId), assignment.scopeType, toId(assignment.scopeId),
  )));
  const create = [];
  const keep = [];
  const salesMemberRole = context.rolesByCode.get(roleCodes.CS_OPERATOR);
  const deactivate = activeAssignments
    .filter((assignment) => (
      toId(assignment.roleId) === toId(salesMemberRole)
      && assignment.scopeType === accessScopeTypes.GLOBAL
    ))
    .map((assignment) => ({
      assignmentId: toId(assignment),
      accountId: toId(assignment.accountId),
      roleCode: roleCodes.CS_OPERATOR,
    }));
  const seen = new Set();

  for (const membership of context.memberships || []) {
    const account = context.accountsById.get(toId(membership.accountId));
    const team = context.teamsById.get(toId(membership.teamId));
    const targetRoles = TEAM_ROLE_TARGETS[team?.code];
    if (!account || !targetRoles) continue;
    const memberType = String(membership.memberType || '').toLowerCase();
    const roleCode = memberType === 'leader' ? targetRoles.leader : targetRoles.member;
    const scopeType = memberType === 'leader' ? accessScopeTypes.GLOBAL : accessScopeTypes.OWN;
    const role = context.rolesByCode.get(roleCode);
    const target = { accountId: toId(account), email: account.email, roleId: toId(role), roleCode, scopeType, scopeId: null };
    const key = assignmentKey(target.accountId, target.roleId, target.scopeType, null);
    if (!seen.has(key)) {
      seen.add(key);
      if (activeKeys.has(key)) keep.push(target);
      else create.push(target);
    }

  }

  return { create, keep, deactivate: [...new Map(deactivate.map((item) => [item.assignmentId, item])).values()] };
}

async function loadContext() {
  const [roles, organizationSource, accounts, assignments] = await Promise.all([
    Role.find({ code: { $in: [...new Set(Object.values(TEAM_ROLE_TARGETS).flatMap(Object.values))] } }).lean(),
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
    await AccessAssignment.findOneAndUpdate(
      { accountId: target.accountId, roleId: target.roleId, scopeType: target.scopeType, scopeId: null },
      {
        $set: { status: accessAssignmentStatuses.ACTIVE },
        $setOnInsert: {
          accountId: target.accountId,
          roleId: target.roleId,
          scopeType: target.scopeType,
          scopeId: null,
          customPermissions: [],
        },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }
  await Promise.all(plan.deactivate.map(({ assignmentId }) => AccessAssignment.updateOne(
    { _id: assignmentId, status: accessAssignmentStatuses.ACTIVE },
    { $set: { status: accessAssignmentStatuses.INACTIVE } },
  )));
  const accountIds = [...new Set([...plan.create, ...plan.deactivate].map(({ accountId }) => accountId))];
  await Promise.all(accountIds.map((accountId) => authManager.invalidatePermissionCache(accountId)));
}

async function migrateOrderDesignAssignments(options = parseArgs()) {
  await connectDatabase();
  try {
    const plan = buildOrderDesignAssignmentPlan(await loadContext());
    const result = {
      apply: options.apply,
      database: mongoose.connection.db.databaseName,
      assignmentsToCreate: plan.create.length,
      assignmentsToKeep: plan.keep.length,
      assignmentsToDeactivate: plan.deactivate.length,
    };
    if (options.apply) await applyPlan(plan);
    logger.info('order_design_assignment_migration_completed', result);
    return result;
  } finally {
    await disconnectRedis();
    await disconnectDatabase();
  }
}

if (require.main === module) {
  migrateOrderDesignAssignments().then((result) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    logger.error('order_design_assignment_migration_failed', { error });
    process.exit(1);
  });
}

module.exports = { buildOrderDesignAssignmentPlan, migrateOrderDesignAssignments };
