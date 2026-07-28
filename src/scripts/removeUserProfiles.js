const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../shared/utils/logger');
const Account = require('../modules/auth/models/account.model');
const EmployeeProfile = require('../modules/hr/models/employeeProfile.model');

function parseArgs(argv = process.argv.slice(2)) {
  return { apply: argv.includes('--apply') };
}

async function removeUserProfiles({ apply = false } = {}) {
  const database = mongoose.connection.db;
  const collection = database.collection('userprofiles');
  const collectionExists = await database
    .listCollections({ name: 'userprofiles' }, { nameOnly: true })
    .hasNext();
  const [accounts, hrAccountIds, legacyProfiles] = await Promise.all([
    Account.countDocuments({}),
    EmployeeProfile.distinct('accountId', { isDeleted: false }),
    collectionExists ? collection.countDocuments({}) : 0,
  ]);
  const accountsWithoutHrProfile = await Account.countDocuments({ _id: { $nin: hrAccountIds } });

  if (apply && collectionExists) await database.dropCollection('userprofiles');

  return {
    mode: apply ? 'apply' : 'dry-run',
    accounts,
    hrProfiles: hrAccountIds.length,
    accountsWithoutHrProfile,
    legacyProfiles,
    legacyCollectionExists: collectionExists,
    collectionDropped: Boolean(apply && collectionExists),
  };
}

async function main() {
  await connectDatabase();
  try {
    logger.info('remove_user_profiles_complete', await removeUserProfiles(parseArgs()));
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('remove_user_profiles_failed', { error });
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, removeUserProfiles };
