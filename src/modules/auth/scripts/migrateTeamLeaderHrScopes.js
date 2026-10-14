const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const { disconnectRedis } = require('../../../config/redis');
const logger = require('../../../shared/utils/logger');
const Account = require('../models/account.model');
const AccessAssignment = require('../models/accessAssignment.model');
const Permission = require('../models/permission.model');
const Role = require('../models/role.model');
const organizationPublic = require('../../organization/public');
const authManager = require('../services/authManager.service');
const { accessAssignmentStatuses, accessScopeTypes, roleCodes } = require('../constants/auth.constants');
const { rolePermissions } = require('./seedRbac');

const toId = (value) => value == null ? null : String(value._id || value.id || value);
const parseArgs = (argv = process.argv.slice(2)) => ({ apply: argv.includes('--apply') });

function buildTeamLeaderPlan(context) {
  if (!context.leaderRole) throw new Error('LEADER role is missing. Run seed:rbac first.');
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
    if (!account || !team) {
      skipped.push({ accountId: toId(membership.accountId), teamId: toId(membership.teamId), reason: 'MISSING_ACCOUNT_OR_TEAM' });
      continue;
    }
    const key = [toId(account), toId(context.leaderRole), accessScopeTypes.TEAM, toId(team)].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    const target = {
      accountId: toId(account),
      email: account.email,
      teamId: toId(team),
      teamCode: team.code,
      roleId: toId(context.leaderRole),
    };
    if (activeKeys.has(key)) keep.push(target);
    else create.push(target);
  }

  return { create, keep, skipped };
}

function summarizeTeamLeaderPlan(plan) {
  return {
    leaders: plan.create.length + plan.keep.length,
    assignmentsToCreate: plan.create.length,
    assignmentsToKeep: plan.keep.length,
    skipped: plan.skipped,
  };
}

async function loadContext() {
  const leaderPermissionCodes = rolePermissions[roleCodes.LEADER];
  const teamLeaderPermissionCodes = rolePermissions[roleCodes.TEAM_LEADER];
  const [leaderRole, leaderPermissionDocs, teamLeaderRole, teamLeaderPermissionDocs, organizationSource, accounts, assignments] = await Promise.all([
    Role.findOne({ code: roleCodes.LEADER }).lean(),
    Permission.find({ code: { $in: leaderPermissionCodes } }).lean(),
    Role.findOne({ code: roleCodes.TEAM_LEADER }).lean(),
    Permission.find({ code: { $in: teamLeaderPermissionCodes } }).lean(),
    organizationPublic.listRoleAssignmentSource({ includeInactive: false }),
    Account.find({ status: 'active' }).select('_id email').lean(),
    AccessAssignment.find({ status: accessAssignmentStatuses.ACTIVE }).lean(),
  ]);
  const leaderPermissionIds = leaderPermissionDocs.map(toId);
  const teamLeaderPermissionIds = teamLeaderPermissionDocs.map(toId);
  if (leaderPermissionIds.length !== leaderPermissionCodes.length) throw new Error('LEADER HR permissions are missing. Run seed:rbac first.');
  if (!teamLeaderRole || teamLeaderPermissionIds.length !== teamLeaderPermissionCodes.length) throw new Error('TEAM_LEADER permissions are missing. Run seed:rbac first.');

  return {
    leaderRole,
    leaderPermissionIds,
    leaderRoleNeedsUpdate: JSON.stringify([...new Set((leaderRole?.permissions || []).map(toId))].sort()) !== JSON.stringify([...leaderPermissionIds].sort()),
    teamLeaderRole,
    teamLeaderPermissionIds,
    teamLeaderRoleNeedsUpdate: JSON.stringify([...new Set((teamLeaderRole.permissions || []).map(toId))].sort()) !== JSON.stringify([...teamLeaderPermissionIds].sort()),
    teamsById: new Map(organizationSource.teams.map((team) => [toId(team), team])),
    accountsById: new Map(accounts.map((account) => [toId(account), account])),
    memberships: organizationSource.memberships,
    assignments,
  };
}

async function applyPlan(context, plan) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (context.leaderRoleNeedsUpdate) {
        await Role.updateOne(
          { _id: context.leaderRole._id },
          { $set: { permissions: context.leaderPermissionIds } },
          { session, runValidators: true },
        );
      }
      if (context.teamLeaderRoleNeedsUpdate) {
        await Role.updateOne(
          { _id: context.teamLeaderRole._id },
          { $set: { permissions: context.teamLeaderPermissionIds } },
          { session, runValidators: true },
        );
      }
      for (const target of plan.create) {
        await AccessAssignment.findOneAndUpdate(
          { accountId: target.accountId, roleId: target.roleId, scopeType: accessScopeTypes.TEAM, scopeId: target.teamId },
          {
            $set: { status: accessAssignmentStatuses.ACTIVE },
            $setOnInsert: {
              accountId: target.accountId,
              roleId: target.roleId,
              scopeType: accessScopeTypes.TEAM,
              scopeId: target.teamId,
              customPermissions: [],
            },
          },
          { session, upsert: true, runValidators: true, setDefaultsOnInsert: true },
        );
      }
    });
  } finally {
    await session.endSession();
  }
  const updatedRoleIds = new Set([toId(context.leaderRole), toId(context.teamLeaderRole)]);
  const affectedAccountIds = new Set([
    ...plan.create.map(({ accountId }) => accountId),
    ...(context.assignments || [])
      .filter((assignment) => updatedRoleIds.has(toId(assignment.roleId)))
      .map((assignment) => toId(assignment.accountId)),
  ]);
  await Promise.all([...affectedAccountIds].map((accountId) => authManager.invalidatePermissionCache(accountId)));
}

async function migrateTeamLeaderHrScopes(options = parseArgs()) {
  await connectDatabase();
  try {
    const context = await loadContext();
    const plan = buildTeamLeaderPlan(context);
    const summary = summarizeTeamLeaderPlan(plan);
    const result = {
      apply: options.apply,
      database: mongoose.connection.db.databaseName,
      leaderRolePermissionsToUpdate: context.leaderRoleNeedsUpdate,
      teamLeaderRolePermissionsToUpdate: context.teamLeaderRoleNeedsUpdate,
      ...summary,
    };
    if (options.apply) await applyPlan(context, plan);
    logger.info('team_leader_hr_scope_migration_completed', result);
    return result;
  } finally {
    await disconnectRedis();
    await disconnectDatabase();
  }
}

if (require.main === module) {
  migrateTeamLeaderHrScopes().then((result) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    logger.error('team_leader_hr_scope_migration_failed', { error });
    process.exit(1);
  });
}

module.exports = { buildTeamLeaderPlan, summarizeTeamLeaderPlan, migrateTeamLeaderHrScopes };
