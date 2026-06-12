const config = require('../../../config');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const authManager = require('../services/authManager.service');
const accountRepository = require('../repositories/account.repository');
const { roleCodes } = require('../constants/auth.constants');

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
      logger.info('bootstrap_admin_exists', { email: bootstrapAdminEmail });
      return;
    }

    await authManager.register(bootstrapAdminEmail, bootstrapAdminPassword, 'Bootstrap Admin', roleCodes.ADMIN);

    logger.info('bootstrap_admin_created', { email: bootstrapAdminEmail });
  } finally {
    await disconnectDatabase();
  }
}

seedAdmin().catch((error) => {
  logger.error('bootstrap_admin_failed', { error });
  process.exit(1);
});
