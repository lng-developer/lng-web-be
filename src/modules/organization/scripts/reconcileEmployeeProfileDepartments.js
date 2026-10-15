const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const hrPublic = require('../../hr/public');
const { organizationStatuses } = require('../constants');
const Team = require('../models/team.model');
const TeamMembership = require('../models/teamMembership.model');

function sameId(left, right) {
  return String(left || '') === String(right || '');
}

async function reconcileEmployeeProfileDepartments({ apply = false } = {}) {
  const summary = {
    apply,
    scannedMemberships: 0,
    alreadySynchronized: 0,
    missingProfiles: 0,
    missingTeams: 0,
    wouldUpdate: 0,
    updated: 0,
  };
  const teams = await Team.find({ status: organizationStatuses.ACTIVE })
    .select('_id departmentId')
    .lean();
  const departmentByTeamId = new Map(
    teams.map((team) => [String(team._id), team.departmentId]),
  );
  const memberships = await TeamMembership.find({ status: organizationStatuses.ACTIVE })
    .select('accountId teamId')
    .lean();

  for (const membership of memberships) {
    summary.scannedMemberships += 1;
    const teamId = String(membership.teamId);
    const departmentId = departmentByTeamId.get(teamId);
    if (!departmentId) {
      summary.missingTeams += 1;
      continue;
    }

    const accountId = String(membership.accountId);
    const profile = await hrPublic.getEmployeeProfileByAccountId(accountId);
    if (!profile) {
      summary.missingProfiles += 1;
      continue;
    }
    if (sameId(profile.teamId, teamId) && sameId(profile.departmentId, departmentId)) {
      summary.alreadySynchronized += 1;
      continue;
    }

    summary.wouldUpdate += 1;
    if (!apply) continue;
    await hrPublic.syncEmployeeProfileTeam(accountId, teamId, { departmentId });
    summary.updated += 1;
  }

  return summary;
}

async function main() {
  await connectDatabase();
  try {
    const summary = await reconcileEmployeeProfileDepartments({
      apply: process.argv.includes('--apply'),
    });
    logger.info('employee_profile_department_reconciliation_completed', summary);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('employee_profile_department_reconciliation_failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { reconcileEmployeeProfileDepartments };
