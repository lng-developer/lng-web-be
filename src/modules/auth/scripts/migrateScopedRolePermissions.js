const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const ScopedRolePermission = require('../models/scopedRolePermission.model');
const { accessScopeTypes } = require('../constants/auth.constants');

async function migrateScopedRolePermissions() {
  const legacyRules = await ScopedRolePermission.db
    .collection('departmentrolepermissions')
    .find({})
    .toArray();

  if (legacyRules.length === 0) {
    return { scanned: 0, upserted: 0 };
  }

  const result = await ScopedRolePermission.bulkWrite(
    legacyRules.map((rule) => ({
      updateOne: {
        filter: {
          scopeType: accessScopeTypes.DEPARTMENT,
          scopeId: rule.departmentId,
          roleId: rule.roleId,
        },
        update: {
          $set: {
            permissions: rule.permissions || [],
            updatedAt: rule.updatedAt || new Date(),
          },
          $setOnInsert: {
            scopeType: accessScopeTypes.DEPARTMENT,
            scopeId: rule.departmentId,
            roleId: rule.roleId,
            createdAt: rule.createdAt || new Date(),
          },
        },
        upsert: true,
      },
    })),
  );

  return {
    scanned: legacyRules.length,
    upserted: result.upsertedCount + result.modifiedCount + result.matchedCount,
  };
}

async function main() {
  await connectDatabase();

  try {
    const result = await migrateScopedRolePermissions();
    logger.info('scoped_role_permissions_migration_complete', result);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('scoped_role_permissions_migration_failed', error);
    process.exitCode = 1;
  });
}

module.exports = {
  migrateScopedRolePermissions,
};
