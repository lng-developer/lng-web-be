const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const logger = require('../../../src/shared/utils/logger');
const Account = require('../../../src/modules/auth/models/account.model');
const { buildDemoUsers } = require('../../../src/modules/auth/scripts/seedDemoUsers');
const EmployeeProfile = require('../../../src/modules/hr/models/employeeProfile.model');
const {
  hrEmployeeStatuses,
  hrEmploymentTypes,
  hrWorkModes,
} = require('../../../src/modules/hr/constants/hr.constants');

function buildProfileOperations(users, accounts) {
  const accountsByEmail = new Map(accounts.map((account) => [account.email.toLowerCase(), account]));

  return users.map((user) => {
    const account = accountsByEmail.get(user.email.toLowerCase());
    if (!account) throw new Error(`Missing demo Account for ${user.email}`);

    return {
      updateOne: {
        filter: { accountId: account._id },
        update: {
          $set: {
            accountId: account._id,
            employeeCode: user.employeeCode,
            fullName: user.fullName,
            jobTitle: user.title,
            workEmail: user.email,
            status: hrEmployeeStatuses.ACTIVE,
            employmentType: hrEmploymentTypes.FULL_TIME,
            workMode: hrWorkModes.ONSITE,
            isProfileUpdated: true,
            isDeleted: false,
            deletedAt: null,
          },
        },
        upsert: true,
      },
    };
  });
}

async function seedHrDemoProfiles({
  users = buildDemoUsers(),
  findAccounts = (emails) => Account.find({ email: { $in: emails } }).lean(),
  writeProfiles = (operations) => EmployeeProfile.bulkWrite(operations, { ordered: true }),
} = {}) {
  const accounts = await findAccounts(users.map(({ email }) => email));
  const operations = buildProfileOperations(users, accounts);
  const result = await writeProfiles(operations);

  return {
    profiles: operations.length,
    upserted: result.upsertedCount || 0,
    modified: result.modifiedCount || 0,
  };
}

async function run() {
  await connectDatabase();
  try {
    logger.info('hr_demo_profiles_seed_completed', await seedHrDemoProfiles());
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  run().catch((error) => {
    logger.error('hr_demo_profiles_seed_failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { buildProfileOperations, seedHrDemoProfiles, run };
