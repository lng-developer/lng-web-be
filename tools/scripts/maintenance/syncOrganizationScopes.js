const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const logger = require('../../../src/shared/utils/logger');
const {
  accessScopeTypes,
  scopeRegistryStatuses,
} = require('../../../src/modules/auth/constants/auth.constants');
const authPublic = require('../../../src/modules/auth/public');
const {
  organizationStatuses,
} = require('../../../src/modules/organization/constants');
const Department = require('../../../src/modules/organization/models/department.model');
const Team = require('../../../src/modules/organization/models/team.model');

function toScopeStatus(status) {
  return status === organizationStatuses.ACTIVE
    ? scopeRegistryStatuses.ACTIVE
    : scopeRegistryStatuses.INACTIVE;
}

async function syncDepartmentScopes() {
  const departments = await Department.find({})
    .select('_id name status')
    .lean();

  for (const department of departments) {
    await authPublic.syncScopeRegistry({
      scopeType: accessScopeTypes.DEPARTMENT,
      scopeId: department._id,
      name: department.name,
      status: toScopeStatus(department.status),
    });
  }

  return departments.length;
}

async function syncTeamScopes() {
  const teams = await Team.find({})
    .select('_id name status')
    .lean();

  for (const team of teams) {
    await authPublic.syncScopeRegistry({
      scopeType: accessScopeTypes.TEAM,
      scopeId: team._id,
      name: team.name,
      status: toScopeStatus(team.status),
    });
  }

  return teams.length;
}

async function syncOrganizationScopes({ manageConnection = true } = {}) {
  if (manageConnection) {
    await connectDatabase();
  }

  try {
    const departments = await syncDepartmentScopes();
    const teams = await syncTeamScopes();

    logger.info('organization_scopes_sync_completed', {
      departments,
      teams,
    });

    return { departments, teams };
  } finally {
    if (manageConnection) {
      await disconnectDatabase();
    }
  }
}

if (require.main === module) {
  syncOrganizationScopes().catch((error) => {
    logger.error('organization_scopes_sync_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  syncOrganizationScopes,
};
