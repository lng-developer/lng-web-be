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

const SALES_TEAM_CODES = new Set(['SALE1', 'SALE2', 'KD']);
const toId = (value) => value == null ? null : String(value._id || value.id || value);
const parseArgs = (argv = process.argv.slice(2)) => ({ apply: argv.includes('--apply') });

function buildSalesLeaderPlan(context) {
  if (!context.salesLeaderRole) throw new Error('SALES_LEADER role is missing. Run seed:rbac first.');
  const activeKeys = new Set((context.assignments || [])
    .filter((assignment) => assignment.status === accessAssignmentStatuses.ACTIVE)
    .map((assignment) => [toId(assignment.accountId), toId(assignment.roleId), assignment.scopeType, toId(assignment.scopeId)].join(':')));
  const create = [];
  const keep = [];
  const skipped = [];
  const seen = new Set();

  for (const membership of context.memberships || []) {
    if (String(membership.memberType || '').toLowerCase() !== 'leader') continue;
    const account = context.accountsById.get(toId(membership.accountId));
    const team = context.teamsById.get(toId(membership.teamId));
    if (!account || !team || !SALES_TEAM_CODES.has(team.code)) continue;
    const key = [toId(account), toId(context.salesLeaderRole), accessScopeTypes.GLOBAL, null].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    const target = {
      accountId: toId(account),
      email: account.email,
      teamCode: team.code,
      roleId: toId(context.salesLeaderRole),
      scopeType: accessScopeTypes.GLOBAL,
    };
    if (activeKeys.has(key)) keep.push(target);
    else create.push(target);
  }

  return { create, keep, skipped };
}

async function loadContext() {
  const [salesLeaderRole, organizationSource, accounts, assignments] = await Promise.all([
    Role.findOne({ code: roleCodes.SALES_LEADER }).lean(),
    organizationPublic.listRoleAssignmentSource({ includeInactive: false }),
    Account.find({ status: 'active' }).select('_id email').lean(),
    AccessAssignment.find({ status: accessAssignmentStatuses.ACTIVE }).lean(),
  ]);

  return {
    salesLeaderRole,
    teamsById: new Map(organizationSource.teams.map((team) => [toId(team), team])),
    accountsById: new Map(accounts.map((account) => [toId(account), account])),
    memberships: organizationSource.memberships,
    assignments,
  };
}

async function applyPlan(plan) {
  for (const target of plan.create) {
    await AccessAssignment.findOneAndUpdate(
      {
        accountId: target.accountId,
        roleId: target.roleId,
        scopeType: target.scopeType,
        scopeId: null,
      },
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
  await Promise.all([...new Set(plan.create.map(({ accountId }) => accountId))]
    .map((accountId) => authManager.invalidatePermissionCache(accountId)));
}

async function migrateSalesLeaderOrders(options = parseArgs()) {
  await connectDatabase();
  try {
    const context = await loadContext();
    const plan = buildSalesLeaderPlan(context);
    const result = {
      apply: options.apply,
      database: mongoose.connection.db.databaseName,
      assignmentsToCreate: plan.create.length,
      assignmentsToKeep: plan.keep.length,
      skipped: plan.skipped,
    };
    if (options.apply) await applyPlan(plan);
    logger.info('sales_leader_orders_migration_completed', result);
    return result;
  } finally {
    await disconnectRedis();
    await disconnectDatabase();
  }
}

if (require.main === module) {
  migrateSalesLeaderOrders().then((result) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    logger.error('sales_leader_orders_migration_failed', { error });
    process.exit(1);
  });
}

module.exports = { buildSalesLeaderPlan, migrateSalesLeaderOrders };
