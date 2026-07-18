const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const EmployeeProfile = require('../models/employeeProfile.model');

async function auditHrProfileReadiness() {
  await connectDatabase();
  try {
    const [totalProfiles, activeProfiles] = await Promise.all([
      EmployeeProfile.countDocuments({}),
      EmployeeProfile.countDocuments({ isDeleted: false }),
    ]);
    logger.info('HR profile readiness audit', { totalProfiles, activeProfiles });
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  auditHrProfileReadiness().catch((error) => {
    logger.error('HR profile readiness audit failed', { error });
    process.exit(1);
  });
}

module.exports = auditHrProfileReadiness;
