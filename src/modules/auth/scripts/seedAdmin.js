const config = require('../../../config');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const authManager = require('../services/authManager.service');
const accountRepository = require('../repositories/account.repository');
const AccessAssignment = require('../models/accessAssignment.model');
const Role = require('../models/role.model');
const {
  accountStatuses,
  accessAssignmentStatuses,
  accessScopeTypes,
  roleCodes,
} = require('../constants/auth.constants');

async function ensureAdminAssignment(accountId) {
  const adminRole = await Role.findOne({ code: roleCodes.ADMIN }).lean();

  if (!adminRole) {
    throw new Error('ADMIN role is not configured. Run npm run seed:rbac first.');
  }

  await AccessAssignment.findOneAndUpdate(
    {
      accountId,
      roleId: adminRole._id,
      scopeType: accessScopeTypes.GLOBAL,
      scopeId: null,
      status: accessAssignmentStatuses.ACTIVE,
    },
    {
      $setOnInsert: {
        accountId,
        roleId: adminRole._id,
        scopeType: accessScopeTypes.GLOBAL,
        scopeId: null,
        customPermissions: [],
        status: accessAssignmentStatuses.ACTIVE,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();
}

async function seedAdmin() {
  const { bootstrapAdminEmail, bootstrapAdminPassword } = config.auth;

  if (!bootstrapAdminEmail || !bootstrapAdminPassword) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required');
  }

  await connectDatabase();

  try {
    const normalizedEmail = authManager.normalizeEmail(bootstrapAdminEmail);
    const existingAccount = await accountRepository.findByNormalizedEmail(normalizedEmail);

    if (existingAccount) {
      if (existingAccount.status !== accountStatuses.ACTIVE) {
        await accountRepository.updateStatus(existingAccount._id, accountStatuses.ACTIVE);
      }

      await ensureAdminAssignment(existingAccount._id);
      logger.info('bootstrap_admin_ensured', { email: bootstrapAdminEmail });
      return;
    }

    const result = await authManager.register(
      bootstrapAdminEmail,
      bootstrapAdminPassword,
      'Bootstrap Admin',
      roleCodes.ADMIN,
    );

    await ensureAdminAssignment(result.account.id);

    logger.info('bootstrap_admin_created', { email: bootstrapAdminEmail });
  } finally {
    await disconnectDatabase();
  }
}

seedAdmin().catch((error) => {
  logger.error('bootstrap_admin_failed', { error });
  process.exit(1);
});
