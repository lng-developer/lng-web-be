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
const { upsertPermissions, upsertRoles } = require('./seedRbac');

const TEAM_ROLE_POLICY = Object.freeze({
  DES: {
    member: [roleCodes.DESIGNER],
    leader: [roleCodes.DESIGNER, roleCodes.DESIGN_REVIEWER, roleCodes.TEAM_LEADER],
  },
  KD: {
    member: [roleCodes.CS_OPERATOR],
    leader: [roleCodes.CS_OPERATOR, roleCodes.TEAM_LEADER],
  },
  SALE1: {
    member: [roleCodes.CS_OPERATOR],
    leader: [roleCodes.CS_OPERATOR, roleCodes.TEAM_LEADER],
  },
  SALE2: {
    member: [roleCodes.CS_OPERATOR],
    leader: [roleCodes.CS_OPERATOR, roleCodes.TEAM_LEADER],
  },
  INVENTORY: {
    member: [roleCodes.FULFILLMENT_OPERATOR],
    leader: [roleCodes.FULFILLMENT_OPERATOR, roleCodes.TEAM_LEADER],
  },
  HCKT: {
    member: [roleCodes.HR_OPERATOR],
    leader: [roleCodes.HR_OPERATOR, roleCodes.TEAM_LEADER],
  },
  HCNS: {
    member: [roleCodes.HR_OPERATOR],
    leader: [roleCodes.HR_OPERATOR, roleCodes.TEAM_LEADER],
  },
  FIN: {
    member: [roleCodes.FINANCE_OPERATOR],
    leader: [roleCodes.FINANCE_OPERATOR, roleCodes.PAYROLL_OPERATOR, roleCodes.TEAM_LEADER],
  },
  DEV: {
    member: [roleCodes.STAFF_VIEWER],
    leader: [roleCodes.STAFF_VIEWER, roleCodes.TEAM_LEADER],
  },
});

function parseArgs(argv = process.argv.slice(2)) {
  return {
    apply: argv.includes('--apply'),
    includeInactive: argv.includes('--include-inactive'),
    teamCode: valueArg(argv, '--team'),
    accountEmail: valueArg(argv, '--email'),
  };
}

function valueArg(argv, name) {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1).trim();
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function toId(value) {
  return value == null ? null : String(value._id || value.id || value);
}

function assignmentKey(assignment) {
  return [
    toId(assignment.accountId),
    toId(assignment.roleId),
    assignment.scopeType,
    assignment.scopeId ? toId(assignment.scopeId) : '',
  ].join(':');
}

function targetRolesForMembership(membership, team) {
  const policy = TEAM_ROLE_POLICY[team.code];
  if (!policy) return [];
  return policy[membership.memberType] || policy.member || [];
}

function activeNonSuperAssignments(assignments, superAdminRoleId) {
  return assignments.filter((assignment) => (
    assignment.status === accessAssignmentStatuses.ACTIVE
    && toId(assignment.roleId) !== superAdminRoleId
  ));
}

async function loadContext(options) {
  const [roles, organizationSource, accounts, assignments] = await Promise.all([
    Role.find({}).lean(),
    organizationPublic.listRoleAssignmentSource({ includeInactive: options.includeInactive }),
    Account.find(options.includeInactive ? {} : { status: 'active' }).select('_id email status').lean(),
    AccessAssignment.find({ status: accessAssignmentStatuses.ACTIVE }).lean(),
  ]);

  return {
    rolesByCode: new Map(roles.map((role) => [role.code, role])),
    teamsById: new Map(organizationSource.teams.map((team) => [toId(team), team])),
    departmentsById: new Map(organizationSource.departments.map((department) => [toId(department), department])),
    accountsById: new Map(accounts.map((account) => [toId(account), account])),
    memberships: organizationSource.memberships,
    assignmentsByAccountId: new Map(accounts.map((account) => [
      toId(account),
      assignments.filter((assignment) => toId(assignment.accountId) === toId(account)),
    ])),
  };
}

function buildPlan(context, options = {}) {
  const superAdminRoleId = toId(context.rolesByCode.get(roleCodes.SUPER_ADMIN));
  const plan = [];
  const skipped = [];
  const missingRoles = new Set();

  for (const membership of context.memberships) {
    const team = context.teamsById.get(toId(membership.teamId));
    const account = context.accountsById.get(toId(membership.accountId));
    if (!team || !account) continue;
    if (options.teamCode && team.code !== options.teamCode) continue;
    if (options.accountEmail && account.email !== options.accountEmail) continue;

    const roleCodesForMember = targetRolesForMembership(membership, team);
    if (!roleCodesForMember.length) {
      skipped.push({ email: account.email, teamCode: team.code, reason: 'NO_TEAM_POLICY' });
      continue;
    }

    const targetAssignments = roleCodesForMember.map((roleCode) => {
      const role = context.rolesByCode.get(roleCode);
      if (!role) {
        if (!options.allowMissingRoles) throw new Error(`${roleCode} role is missing. Run seed:rbac first.`);
        missingRoles.add(roleCode);
      }
      return {
        accountId: toId(account),
        roleId: role ? toId(role) : `missing:${roleCode}`,
        roleCode,
        scopeType: accessScopeTypes.TEAM,
        scopeId: toId(team),
      };
    });

    const currentAssignments = activeNonSuperAssignments(
      context.assignmentsByAccountId.get(toId(account)) || [],
      superAdminRoleId,
    );
    const targetKeys = new Set(targetAssignments.map(assignmentKey));
    const currentKeys = new Set(currentAssignments.map(assignmentKey));

    plan.push({
      accountId: toId(account),
      email: account.email,
      teamId: toId(team),
      teamCode: team.code,
      departmentCode: context.departmentsById.get(toId(team.departmentId))?.code || null,
      memberType: membership.memberType,
      deactivate: currentAssignments
        .filter((assignment) => !targetKeys.has(assignmentKey(assignment)))
        .map((assignment) => toId(assignment)),
      create: targetAssignments.filter((assignment) => !currentKeys.has(assignmentKey(assignment))),
      keep: currentAssignments.filter((assignment) => targetKeys.has(assignmentKey(assignment))).map((assignment) => toId(assignment)),
    });
  }

  return { plan, skipped, missingRoles: [...missingRoles].sort() };
}

async function applyPlan(plan) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const item of plan) {
        if (item.deactivate.length) {
          await AccessAssignment.updateMany(
            { _id: { $in: item.deactivate } },
            { $set: { status: accessAssignmentStatuses.INACTIVE } },
            { session, runValidators: true },
          );
        }

        for (const target of item.create) {
          await AccessAssignment.findOneAndUpdate(
            {
              accountId: target.accountId,
              roleId: target.roleId,
              scopeType: target.scopeType,
              scopeId: target.scopeId,
            },
            {
              $set: {
                status: accessAssignmentStatuses.ACTIVE,
              },
              $setOnInsert: {
                accountId: target.accountId,
                roleId: target.roleId,
                scopeType: target.scopeType,
                scopeId: target.scopeId,
                customPermissions: [],
              },
              $unset: {
                overridePermissions: '',
              },
            },
            {
              session,
              returnDocument: 'after',
              upsert: true,
              runValidators: true,
              setDefaultsOnInsert: true,
            },
          );
        }
      }
    });
  } finally {
    await session.endSession();
  }
}

async function invalidateChangedAccounts(plan) {
  const accountIds = [...new Set(plan
    .filter((item) => item.deactivate.length || item.create.length)
    .map((item) => item.accountId))];
  await Promise.all(accountIds.map((accountId) => authManager.invalidatePermissionCache(accountId)));
}

function summarize(result) {
  return {
    accounts: result.plan.length,
    assignmentsToDeactivate: result.plan.reduce((total, item) => total + item.deactivate.length, 0),
    assignmentsToCreate: result.plan.reduce((total, item) => total + item.create.length, 0),
    assignmentsToKeep: result.plan.reduce((total, item) => total + item.keep.length, 0),
    skipped: result.skipped,
    missingRoles: result.missingRoles || [],
  };
}

async function rebalanceRoleAssignments(options = parseArgs()) {
  await connectDatabase();
  try {
    if (options.apply) {
      const permissionDocs = await upsertPermissions();
      await upsertRoles(permissionDocs);
    }
    const context = await loadContext(options);
    const result = buildPlan(context, { ...options, allowMissingRoles: !options.apply });
    const summary = summarize(result);

    if (options.apply) {
      await applyPlan(result.plan);
      await invalidateChangedAccounts(result.plan);
    }

    logger.info('rbac_rebalance_completed', {
      apply: options.apply,
      database: mongoose.connection.db.databaseName,
      ...summary,
    });
    return { apply: options.apply, database: mongoose.connection.db.databaseName, ...summary };
  } finally {
    await disconnectRedis();
    await disconnectDatabase();
  }
}

if (require.main === module) {
  rebalanceRoleAssignments().then((result) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    logger.error('rbac_rebalance_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  TEAM_ROLE_POLICY,
  buildPlan,
  rebalanceRoleAssignments,
};
