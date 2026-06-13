const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../shared/utils/logger');
const TeamMembership = require('../modules/organization/models/teamMembership.model');
const { organizationStatuses } = require('../modules/organization/constants');

async function repairTeamMemberships({ manageConnection = true } = {}) {
  if (manageConnection) {
    await connectDatabase();
  }

  try {
    const activeMemberships = await TeamMembership.find({
      status: organizationStatuses.ACTIVE,
    })
      .sort({ accountId: 1, updatedAt: -1, createdAt: -1, _id: -1 })
      .lean();
    const keepByAccountId = new Set();
    const duplicateIds = [];

    for (const membership of activeMemberships) {
      const accountId = String(membership.accountId);

      if (keepByAccountId.has(accountId)) {
        duplicateIds.push(membership._id);
        continue;
      }

      keepByAccountId.add(accountId);
    }

    if (duplicateIds.length > 0) {
      await TeamMembership.updateMany(
        { _id: { $in: duplicateIds } },
        { $set: { status: organizationStatuses.INACTIVE } },
        { runValidators: true },
      );
    }

    await TeamMembership.syncIndexes();

    logger.info('team_memberships_repaired', {
      activeAccounts: keepByAccountId.size,
      deactivatedDuplicates: duplicateIds.length,
    });

    return {
      activeAccounts: keepByAccountId.size,
      deactivatedDuplicates: duplicateIds.length,
    };
  } finally {
    if (manageConnection) {
      await disconnectDatabase();
    }
  }
}

if (require.main === module) {
  repairTeamMemberships().catch((error) => {
    logger.error('team_memberships_repair_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  repairTeamMemberships,
};
